import { Inject, Injectable, Logger } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';
import { isExclusionViolation, isUniqueViolation } from '../../database/prisma-errors';
import { AppError, ErrorCode } from '../../common/errors';
import type { AuthUser } from '../../common/auth-user';
import { OutboxService } from '../../services/outbox.service';
import { MetricsService } from '../../services/metrics.service';
import { AuditService } from '../../services/audit.service';
import { PAYMENT_GATEWAY, PaymentGateway, PaymentProviderError, ProviderPayment, ProviderRefund } from '../../integrations/razorpay/payment-gateway';
import { BookingsService } from '../bookings/bookings.service';
import { HttpStatus } from '@nestjs/common';

export type SettleOutcome = 'confirmed' | 'already_confirmed' | 'conflict_refunded' | 'pending' | 'failed' | 'mismatch';

const SUCCESS: PaymentStatus[] = ['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED'];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly bookings: BookingsService,
    private readonly outbox: OutboxService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates (or reuses) the Razorpay order for a pending booking. The amount always comes from the
   * booking row computed server-side. Only public checkout fields are returned to the browser.
   */
  async createOrder(user: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { subject: { select: { name: true } }, teacher: { select: { user: { select: { fullName: true } } } }, student: { select: { fullName: true, email: true, phone: true } } },
    });
    if (!booking || booking.studentId !== user.id) throw AppError.notFound('Booking');
    if (booking.status !== 'PENDING_PAYMENT' || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date())
      throw AppError.unprocessable(ErrorCode.BOOKING_INVALID_STATE, 'This reservation has expired. Please choose the slot again.');
    if (!this.gateway.configured) throw AppError.notConfigured('Razorpay');

    let payment = await this.prisma.payment.findFirst({
      where: { bookingId, status: { in: ['CREATED', 'FAILED', 'AUTHORIZED'] }, amountMinor: booking.totalMinor },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      let order;
      try {
        order = await this.gateway.createOrder({
          amountMinor: booking.totalMinor,
          currency: booking.currency,
          receipt: booking.id,
          notes: { bookingId: booking.id, studentId: booking.studentId },
        });
      } catch (err) {
        this.metrics.paymentEvents.inc({ event: 'order_failed' });
        if (err instanceof PaymentProviderError)
          throw new AppError(ErrorCode.PAYMENT_PROVIDER_ERROR, 'Could not start payment. Please try again.', HttpStatus.BAD_GATEWAY);
        throw err;
      }
      if (order.amount !== booking.totalMinor || order.currency !== booking.currency)
        throw new AppError(ErrorCode.PAYMENT_PROVIDER_ERROR, 'Payment provider returned an unexpected amount', HttpStatus.BAD_GATEWAY);
      try {
        payment = await this.prisma.payment.create({
          data: { bookingId, providerOrderId: order.id, amountMinor: order.amount, currency: order.currency },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { providerOrderId: order.id } });
      }
      this.metrics.paymentEvents.inc({ event: 'order_created' });
    }

    return {
      provider: 'razorpay',
      keyId: this.gateway.publicKeyId,
      orderId: payment.providerOrderId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      holdExpiresAt: booking.holdExpiresAt,
      description: `${booking.subject.name} with ${booking.teacher.user.fullName}`,
      prefill: { name: booking.student.fullName, email: booking.student.email, contact: booking.student.phone ?? undefined },
    };
  }

  /**
   * Checkout callback: the browser forwards Razorpay's ids + signature. We verify the signature,
   * then fetch the payment from Razorpay (never trusting the client) and settle it.
   */
  async verifyCheckout(user: AuthUser, dto: { bookingId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: dto.razorpay_order_id }, include: { booking: true } });
    if (!payment || payment.bookingId !== dto.bookingId || payment.booking.studentId !== user.id) throw AppError.notFound('Payment');

    if (!this.gateway.verifyCheckoutSignature(dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature)) {
      this.metrics.paymentEvents.inc({ event: 'signature_invalid' });
      await this.audit.record({ actorId: user.id, action: 'payment.signature_invalid', entityType: 'Payment', entityId: payment.id });
      throw AppError.badRequest(ErrorCode.PAYMENT_VERIFICATION_FAILED, 'Payment could not be verified');
    }

    let provider: ProviderPayment;
    try {
      provider = await this.gateway.fetchPayment(dto.razorpay_payment_id);
    } catch {
      // Signature is valid but we can't reach Razorpay right now; the webhook/reconciler will settle it.
      return { outcome: 'pending' as SettleOutcome, bookingId: payment.bookingId };
    }
    const outcome = await this.settle(payment.id, provider, 'checkout');
    return { outcome, bookingId: payment.bookingId };
  }

  /** Browser reports that the Checkout modal returned a failure. Informational only. */
  async reportClientFailure(user: AuthUser, bookingId: string, reason: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.studentId !== user.id) throw AppError.notFound('Booking');
    this.logger.log({ bookingId, reason: reason.slice(0, 200) }, 'Client reported payment failure');
    return { recorded: true };
  }

  /**
   * Single, idempotent settlement path shared by checkout verification, webhooks and reconciliation.
   * Validates order association, amount, currency and status before confirming the booking.
   */
  async settle(paymentId: string, provider: ProviderPayment, source: 'checkout' | 'webhook' | 'reconcile'): Promise<SettleOutcome> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    if (provider.order_id !== payment.providerOrderId || provider.amount !== payment.amountMinor || provider.currency !== payment.currency) {
      await this.flagDiscrepancy(payment, `AMOUNT_OR_ORDER_MISMATCH: provider ${provider.order_id}/${provider.amount} ${provider.currency}`);
      return 'mismatch';
    }

    if (provider.status === 'failed') {
      await this.recordFailure(payment, provider);
      return 'failed';
    }

    if (provider.status === 'authorized') {
      // Auto-capture is normally enabled on the Razorpay account; capture explicitly otherwise.
      try {
        provider = await this.gateway.capturePayment(provider.id, payment.amountMinor, payment.currency);
      } catch (err) {
        this.logger.warn({ err, paymentId }, 'Capture failed; will retry via reconciliation');
        await this.prisma.payment.updateMany({ where: { id: payment.id, status: { in: ['CREATED', 'FAILED'] } }, data: { status: 'AUTHORIZED', providerPaymentId: provider.id } });
        return 'pending';
      }
    }

    if (provider.status !== 'captured') return 'pending';

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        const p = await this.lockPayment(tx, payment.id);
        const booking = await this.bookings.lock(tx, p.bookingId);
        if (SUCCESS.includes(p.status) && (booking.status === 'CONFIRMED' || booking.status === 'COMPLETED')) return 'already_confirmed' as const;

        await tx.payment.update({
          where: { id: p.id },
          data: {
            status: SUCCESS.includes(p.status) ? p.status : 'CAPTURED',
            providerPaymentId: provider.id,
            method: provider.method ?? null,
            capturedAt: p.capturedAt ?? new Date(),
            failureReason: null,
          },
        });

        const stillValid = await this.bookingStillConfirmable(tx, booking);
        if (stillValid !== true) throw new ConfirmationBlocked(stillValid);

        await this.bookings.transition(tx, booking, 'CONFIRMED', {
          reason: `Payment verified (${source})`,
          data: { confirmedAt: new Date(), holdExpiresAt: null },
          metadata: { paymentId: p.id, providerPaymentId: provider.id },
        });
        await this.outbox.publish(tx, { type: 'booking.confirmed', aggregateId: booking.id, payload: { bookingId: booking.id } });
        return 'confirmed' as const;
      });
      this.metrics.paymentEvents.inc({ event: `settled_${outcome}` });
      return outcome;
    } catch (err) {
      if (isExclusionViolation(err) || err instanceof ConfirmationBlocked) {
        const reason = err instanceof ConfirmationBlocked ? err.message : 'Slot was taken before payment completed';
        await this.refundUnconfirmable(payment.id, provider, reason);
        return 'conflict_refunded';
      }
      throw err;
    }
  }

  private async bookingStillConfirmable(tx: Tx, booking: { teacherId: string; startAt: Date; status: string }): Promise<true | string> {
    if (!['PENDING_PAYMENT', 'EXPIRED', 'PAYMENT_FAILED'].includes(booking.status)) return `Booking is ${booking.status}`;
    if (booking.startAt <= new Date()) return 'Session start time has passed';
    const teacher = await tx.teacherProfile.findUnique({ where: { id: booking.teacherId }, include: { user: { select: { status: true } } } });
    if (!teacher || teacher.approvalStatus !== 'APPROVED' || teacher.user.status !== 'ACTIVE') return 'Teacher is no longer available';
    return true;
  }

  /** Payment succeeded but the booking can't be confirmed: record it, refund in full, alert ops. */
  private async refundUnconfirmable(paymentId: string, provider: ProviderPayment, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const p = await this.lockPayment(tx, paymentId);
      await tx.payment.update({
        where: { id: p.id },
        data: {
          status: SUCCESS.includes(p.status) ? p.status : 'CAPTURED',
          providerPaymentId: provider.id,
          capturedAt: p.capturedAt ?? new Date(),
          discrepancy: `UNCONFIRMABLE: ${reason}`,
        },
      });
      const already = await tx.refund.findFirst({ where: { paymentId: p.id, reason: { startsWith: 'UNCONFIRMABLE' } } });
      if (!already) {
        const refund = await tx.refund.create({
          data: { paymentId: p.id, bookingId: p.bookingId, amountMinor: p.amountMinor - p.refundedMinor, reason: `UNCONFIRMABLE: ${reason}` },
        });
        await tx.booking.update({ where: { id: p.bookingId }, data: { cancellationReason: `${reason}. A full refund has been issued.` } });
        await this.outbox.publish(tx, { type: 'refund.requested', aggregateId: refund.id, payload: { refundId: refund.id } });
        await this.outbox.publish(tx, { type: 'payment.conflict', aggregateId: p.bookingId, payload: { bookingId: p.bookingId, paymentId: p.id } });
      }
    });
    this.metrics.paymentEvents.inc({ event: 'conflict_refund' });
  }

  private async recordFailure(payment: Payment, provider: ProviderPayment) {
    const reason = provider.error_description ?? provider.error_code ?? 'Payment failed';
    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ['CREATED', 'AUTHORIZED', 'FAILED'] } },
        data: { status: 'FAILED', failureReason: reason.slice(0, 300), method: provider.method ?? null },
      });
      if (res.count) {
        await this.outbox.publish(tx, { type: 'payment.failed', aggregateId: provider.id, payload: { bookingId: payment.bookingId, paymentId: payment.id, reason } });
      }
      return res.count;
    });
    if (updated) this.metrics.paymentEvents.inc({ event: 'failed' });
  }

  private async flagDiscrepancy(payment: Payment, discrepancy: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: payment.id }, data: { discrepancy } });
      await this.outbox.publish(tx, {
        type: 'admin.alert',
        aggregateId: payment.id,
        payload: { title: 'Payment discrepancy detected', detail: `Payment ${payment.id}: ${discrepancy}` },
      });
    });
    this.metrics.paymentEvents.inc({ event: 'discrepancy' });
  }

  private async lockPayment(tx: Tx, paymentId: string) {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId}::uuid FOR UPDATE`;
    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  // ---------------- Webhooks ----------------

  /**
   * Razorpay webhook: verified with the raw body + webhook secret, recorded by event id
   * (x-razorpay-event-id) so retries are processed once. Out-of-order events are safe because
   * settlement is monotonic (a failure never downgrades a captured payment).
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined, eventId: string | undefined) {
    if (!signature || !this.gateway.verifyWebhookSignature(rawBody, signature)) {
      this.metrics.paymentEvents.inc({ event: 'webhook_signature_invalid' });
      throw AppError.badRequest(ErrorCode.PAYMENT_VERIFICATION_FAILED, 'Invalid webhook signature');
    }
    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload: { payment?: { entity: ProviderPayment }; refund?: { entity: ProviderRefund }; order?: { entity: { id: string } } };
      created_at?: number;
    };
    const id = eventId ?? `${event.event}:${event.payload.payment?.entity.id ?? event.payload.refund?.entity.id}:${event.created_at}`;

    let record = await this.prisma.webhookEvent.findUnique({ where: { provider_eventId: { provider: 'RAZORPAY', eventId: id } } });
    if (record?.processedAt) return { status: 'duplicate' };
    if (!record) {
      try {
        record = await this.prisma.webhookEvent.create({
          data: { provider: 'RAZORPAY', eventId: id, eventType: event.event, payload: event as unknown as Prisma.InputJsonValue },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        return { status: 'duplicate' };
      }
    }

    try {
      const result = await this.dispatchWebhook(event);
      await this.prisma.webhookEvent.update({ where: { id: record.id }, data: { processedAt: new Date(), error: null } });
      this.metrics.paymentEvents.inc({ event: `webhook_${event.event}` });
      return { status: 'processed', result };
    } catch (err) {
      await this.prisma.webhookEvent.update({ where: { id: record.id }, data: { error: String((err as Error).message).slice(0, 500) } });
      throw err;
    }
  }

  private async dispatchWebhook(event: { event: string; payload: { payment?: { entity: ProviderPayment }; refund?: { entity: ProviderRefund } } }) {
    switch (event.event) {
      case 'payment.authorized':
      case 'payment.captured':
      case 'payment.failed':
      case 'order.paid': {
        const entity = event.payload.payment?.entity;
        if (!entity?.order_id) return 'ignored';
        const payment = await this.prisma.payment.findUnique({ where: { providerOrderId: entity.order_id } });
        if (!payment) return 'unknown_order';
        return this.settle(payment.id, entity, 'webhook');
      }
      case 'refund.created':
      case 'refund.processed':
      case 'refund.failed': {
        const entity = event.payload.refund?.entity;
        if (!entity) return 'ignored';
        return this.applyProviderRefund(entity);
      }
      default:
        return 'ignored';
    }
  }

  // ---------------- Refunds ----------------

  /** Worker: submit a refund to Razorpay exactly once (adopting an existing provider refund on retry). */
  async processRefund(refundId: string) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!refund) return 'missing';
    if (refund.status === 'PROCESSED' || refund.status === 'FAILED') return refund.status;
    if (!refund.payment.providerPaymentId) throw new Error('Payment has no provider payment id yet');

    if (refund.providerRefundId) {
      const list = await this.gateway.listRefunds(refund.payment.providerPaymentId);
      const match = list.find((r) => r.id === refund.providerRefundId);
      if (match) await this.applyProviderRefund(match);
      return 'polled';
    }

    const existing = (await this.gateway.listRefunds(refund.payment.providerPaymentId)).find(
      (r) => !Array.isArray(r.notes) && (r.notes as Record<string, string> | undefined)?.refundId === refund.id,
    );
    const provider =
      existing ??
      (await this.gateway.createRefund(refund.payment.providerPaymentId, {
        amountMinor: refund.amountMinor,
        receipt: refund.id,
        notes: { refundId: refund.id, bookingId: refund.bookingId },
      }));
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { providerRefundId: provider.id, status: 'SUBMITTED', attempts: { increment: 1 } },
    });
    await this.applyProviderRefund(provider);
    return 'submitted';
  }

  async markRefundFailed(refundId: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refundId }, data: { status: 'FAILED', failureReason: reason.slice(0, 300) } });
      await this.outbox.publish(tx, { type: 'refund.updated', aggregateId: refundId, payload: { refundId } });
      await this.outbox.publish(tx, { type: 'admin.alert', aggregateId: refundId, payload: { title: 'Refund failed', detail: `Refund ${refundId}: ${reason}` } });
    });
  }

  /** Apply provider refund state monotonically and keep Payment.refundedMinor consistent. */
  private async applyProviderRefund(entity: ProviderRefund) {
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findFirst({
        where: { OR: [{ providerRefundId: entity.id }, ...(notesRefundId(entity) ? [{ id: notesRefundId(entity)! }] : [])] },
      });
      if (!refund) return 'unknown_refund';
      const next = entity.status === 'processed' ? 'PROCESSED' : entity.status === 'failed' ? 'FAILED' : 'SUBMITTED';
      if (refund.status === 'PROCESSED' || (refund.status === 'FAILED' && next !== 'PROCESSED') || refund.status === next) {
        if (!refund.providerRefundId) await tx.refund.update({ where: { id: refund.id }, data: { providerRefundId: entity.id } });
        return 'unchanged';
      }
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: next, providerRefundId: entity.id, processedAt: next === 'PROCESSED' ? new Date() : null },
      });
      if (next === 'PROCESSED') {
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${refund.paymentId}::uuid FOR UPDATE`;
        const agg = await tx.refund.aggregate({ where: { paymentId: refund.paymentId, status: 'PROCESSED' }, _sum: { amountMinor: true } });
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
        const refunded = Math.min(agg._sum.amountMinor ?? 0, payment.amountMinor);
        await tx.payment.update({
          where: { id: payment.id },
          data: { refundedMinor: refunded, status: refunded >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
        });
      }
      await this.outbox.publish(tx, { type: 'refund.updated', aggregateId: refund.id, payload: { refundId: refund.id } });
      return next;
    });
  }

  // ---------------- Reconciliation ----------------

  /** Settles payments whose webhook/callback was missed and polls in-flight refunds. */
  async reconcile(limit = 100) {
    if (!this.gateway.configured) return { payments: 0, refunds: 0 };
    const since = new Date(Date.now() - 3 * 86_400_000);
    const open = await this.prisma.payment.findMany({
      where: {
        createdAt: { gt: since, lt: new Date(Date.now() - 2 * 60_000) },
        status: { in: ['CREATED', 'AUTHORIZED', 'FAILED'] },
        booking: { status: { in: ['PENDING_PAYMENT', 'EXPIRED', 'PAYMENT_FAILED'] } },
      },
      take: limit,
      orderBy: { lastReconciledAt: { sort: 'asc', nulls: 'first' } },
    });
    for (const p of open) {
      try {
        const attempts = await this.gateway.fetchOrderPayments(p.providerOrderId);
        const winner = attempts.find((a) => a.status === 'captured') ?? attempts.find((a) => a.status === 'authorized');
        if (winner) await this.settle(p.id, winner, 'reconcile');
        await this.prisma.payment.update({ where: { id: p.id }, data: { lastReconciledAt: new Date() } });
      } catch (err) {
        this.logger.warn({ err, paymentId: p.id }, 'Reconciliation failed for payment');
      }
    }
    const refunds = await this.prisma.refund.findMany({ where: { status: { in: ['PENDING', 'SUBMITTED'] }, createdAt: { lt: new Date(Date.now() - 5 * 60_000) } }, take: limit });
    for (const r of refunds) {
      try {
        await this.processRefund(r.id);
      } catch (err) {
        this.logger.warn({ err, refundId: r.id }, 'Refund poll failed');
      }
    }
    return { payments: open.length, refunds: refunds.length };
  }

  /** Admin: on-demand reconciliation of a single payment. */
  async reconcileOne(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw AppError.notFound('Payment');
    const attempts = await this.gateway.fetchOrderPayments(p.providerOrderId);
    const winner = attempts.find((a) => a.status === 'captured') ?? attempts.find((a) => a.status === 'authorized') ?? attempts[0];
    const outcome = winner ? await this.settle(p.id, winner, 'reconcile') : 'pending';
    await this.prisma.payment.update({ where: { id: p.id }, data: { lastReconciledAt: new Date() } });
    return { outcome, providerAttempts: attempts.map((a) => ({ id: a.id, status: a.status, amount: a.amount })) };
  }
}

class ConfirmationBlocked extends Error {}

function notesRefundId(entity: ProviderRefund): string | undefined {
  const notes = entity.notes;
  if (!notes || Array.isArray(notes)) return undefined;
  const id = (notes as Record<string, string>).refundId;
  return /^[0-9a-f-]{36}$/.test(id ?? '') ? id : undefined;
}
