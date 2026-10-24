import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Booking, BookingStatus, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';
import { isExclusionViolation } from '../../database/prisma-errors';
import { AppError, ErrorCode } from '../../common/errors';
import type { AuthUser } from '../../common/auth-user';
import { SettingsService } from '../../services/settings.service';
import { OutboxService } from '../../services/outbox.service';
import { AuditService } from '../../services/audit.service';
import { MetricsService } from '../../services/metrics.service';
import { calculatePrice } from '../../utils/money';
import { addMinutes } from '../../utils/time';
import { AvailabilityService } from '../availability/availability.service';
import { assertTransition, InvalidTransitionError } from './booking-state';
import { CancelActor, decideRefund, PolicySnapshot, rescheduleCheck } from './booking-policy';
import { BOOKING_INCLUDE, toBookingView, Viewer } from './booking.mapper';
import { CreateBookingDto, ListBookingsQuery } from './dto/bookings.dto';

export interface TransitionOptions {
  actorId?: string | null;
  reason?: string;
  data?: Prisma.BookingUpdateManyMutationInput;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Step 1-5 of the booking lifecycle: validate everything server-side and create a short-lived
   * PENDING_PAYMENT hold. The exclusion constraint makes concurrent holds for the same time impossible.
   */
  async reserve(student: AuthUser, dto: CreateBookingDto): Promise<Booking> {
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { id: dto.teacherId },
      include: { user: { select: { id: true, status: true } }, subjects: { where: { subjectId: dto.subjectId }, include: { subject: true } } },
    });
    if (!teacher || teacher.approvalStatus !== 'APPROVED' || teacher.user.status !== 'ACTIVE')
      throw AppError.unprocessable(ErrorCode.TEACHER_UNAVAILABLE, 'This teacher is not currently accepting bookings');
    if (teacher.userId === student.id) throw AppError.unprocessable(ErrorCode.BOOKING_POLICY_VIOLATION, 'You cannot book yourself');
    const ts = teacher.subjects[0];
    if (!ts || !ts.isActive || !ts.subject.isActive)
      throw AppError.unprocessable(ErrorCode.TEACHER_UNAVAILABLE, 'This teacher does not teach that subject');

    const [rules, pricing, cancellation, reschedule] = await Promise.all([
      this.settings.get('booking.rules'),
      this.settings.get('pricing.rules'),
      this.settings.get('policy.cancellation'),
      this.settings.get('policy.reschedule'),
    ]);
    if (!teacher.sessionDurations.includes(dto.durationMinutes) || !rules.allowedDurations.includes(dto.durationMinutes))
      throw AppError.unprocessable(ErrorCode.BOOKING_POLICY_VIOLATION, 'That session length is not offered');

    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime())) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Invalid start time');
    if (!(await this.availability.isBookable(teacher, startAt, dto.durationMinutes)))
      throw AppError.conflict(ErrorCode.SLOT_UNAVAILABLE, 'That time is no longer available. Please pick another slot.');

    const price = calculatePrice(ts.hourlyRateMinor, dto.durationMinutes, pricing);
    const endAt = addMinutes(startAt, dto.durationMinutes);
    const policy: PolicySnapshot = { cancellation, reschedule };
    const student$ = await this.prisma.user.findUniqueOrThrow({ where: { id: student.id }, select: { timezone: true } });

    try {
      const booking = await this.prisma.$transaction(async (tx) => {
        await this.expireStaleHolds(tx, { teacherId: teacher.id, studentId: student.id });
        const created = await tx.booking.create({
          data: {
            studentId: student.id,
            teacherId: teacher.id,
            subjectId: dto.subjectId,
            startAt,
            endAt,
            blockedUntil: addMinutes(endAt, teacher.bufferMinutes),
            durationMinutes: dto.durationMinutes,
            studentTimezone: student$.timezone,
            teacherTimezone: teacher.timezone,
            status: 'PENDING_PAYMENT',
            holdExpiresAt: addMinutes(new Date(), rules.holdMinutes),
            ...price,
            currency: pricing.currency,
            policySnapshot: policy as unknown as Prisma.InputJsonValue,
            studentNote: dto.note?.trim() || null,
          },
        });
        await tx.bookingStatusHistory.create({
          data: { bookingId: created.id, toStatus: 'PENDING_PAYMENT', actorId: student.id, reason: 'Slot reserved for checkout' },
        });
        return created;
      });
      this.metrics.bookingEvents.inc({ event: 'reserved' });
      return booking;
    } catch (err) {
      if (isExclusionViolation(err, 'booking_student_no_overlap')) {
        this.metrics.bookingEvents.inc({ event: 'conflict_student' });
        throw AppError.conflict(ErrorCode.SLOT_UNAVAILABLE, 'You already have a session booked at that time');
      }
      if (isExclusionViolation(err)) {
        this.metrics.bookingEvents.inc({ event: 'conflict' });
        throw AppError.conflict(ErrorCode.SLOT_UNAVAILABLE, 'That time was just booked by someone else. Please pick another slot.');
      }
      throw err;
    }
  }

  /**
   * Expire PENDING_PAYMENT holds whose timer has passed. Called inline before new reservations
   * (so a stale hold never blocks a slot) and periodically by the maintenance worker.
   */
  async expireStaleHolds(tx: Tx, scope?: { teacherId?: string; studentId?: string }) {
    const filters: Prisma.Sql[] = [Prisma.sql`b.status = 'PENDING_PAYMENT'`, Prisma.sql`b."holdExpiresAt" < now()`];
    if (scope?.teacherId && scope.studentId)
      filters.push(Prisma.sql`(b."teacherId" = ${scope.teacherId}::uuid OR b."studentId" = ${scope.studentId}::uuid)`);
    const rows = await tx.$queryRaw<{ id: string; status: BookingStatus }[]>`
      UPDATE "Booking" b
         SET status = (CASE WHEN EXISTS (SELECT 1 FROM "Payment" p WHERE p."bookingId" = b.id AND p.status = 'FAILED')
                            THEN 'PAYMENT_FAILED' ELSE 'EXPIRED' END)::"BookingStatus",
             version = version + 1,
             "updatedAt" = now()
       WHERE ${Prisma.join(filters, ' AND ')}
   RETURNING b.id, b.status`;
    if (rows.length) {
      await tx.bookingStatusHistory.createMany({
        data: rows.map((r) => ({ bookingId: r.id, fromStatus: 'PENDING_PAYMENT' as const, toStatus: r.status, reason: 'Checkout hold expired' })),
      });
      this.metrics.bookingEvents.inc({ event: 'expired' }, rows.length);
    }
    return rows.length;
  }

  /**
   * Guarded status change: validates the state machine and uses a compare-and-set on the current
   * status so concurrent writers cannot both win.
   */
  async transition(tx: Tx, booking: Pick<Booking, 'id' | 'status'>, to: BookingStatus, o: TransitionOptions = {}) {
    assertTransition(booking.status, to);
    const res = await tx.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data: { ...o.data, status: to, version: { increment: 1 } },
    });
    if (res.count !== 1)
      throw AppError.conflict(ErrorCode.BOOKING_INVALID_STATE, 'The booking changed while processing; please refresh');
    await tx.bookingStatusHistory.create({
      data: { bookingId: booking.id, fromStatus: booking.status, toStatus: to, actorId: o.actorId ?? null, reason: o.reason, metadata: o.metadata },
    });
  }

  /** Locks the booking row for the remainder of the transaction. */
  async lock(tx: Tx, bookingId: string) {
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId}::uuid FOR UPDATE`;
    return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  }

  async cancel(actor: AuthUser, bookingId: string, reason?: string, adminRefundPercent?: number) {
    const booking = await this.loadAuthorized(actor, bookingId);
    const actorType: CancelActor = actor.role === 'ADMIN' ? 'ADMIN' : actor.role === 'TEACHER' ? 'TEACHER' : 'STUDENT';
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const b = await this.lock(tx, booking.id);
      if (b.status === 'PENDING_PAYMENT') {
        if (actorType === 'TEACHER') throw AppError.unprocessable(ErrorCode.BOOKING_INVALID_STATE, 'This booking is not confirmed yet');
        await this.transition(tx, b, 'CANCELLED', {
          actorId: actor.id,
          reason: reason ?? 'Checkout abandoned',
          data: { cancelledAt: now, cancelledById: actor.id, cancellationReason: reason ?? 'Checkout abandoned', holdExpiresAt: null },
        });
        return { refundMinor: 0, rule: 'NOT_PAID' };
      }
      if (b.status !== 'CONFIRMED')
        throw AppError.unprocessable(ErrorCode.BOOKING_INVALID_STATE, `A ${b.status.toLowerCase().replace('_', ' ')} booking cannot be cancelled`);
      if (b.startAt <= now && actorType !== 'ADMIN')
        throw AppError.unprocessable(ErrorCode.BOOKING_POLICY_VIOLATION, 'Sessions that have started cannot be cancelled. Contact support.');

      const policy = (b.policySnapshot as unknown as PolicySnapshot).cancellation;
      const payment = await tx.payment.findFirst({ where: { bookingId: b.id, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } });
      const paid = payment ? payment.amountMinor - payment.refundedMinor : 0;
      const decision = decideRefund({ totalMinor: Math.min(paid, b.totalMinor), startAt: b.startAt, now, actor: actorType, policy, adminPercent: adminRefundPercent });

      await this.transition(tx, b, 'CANCELLED', {
        actorId: actor.id,
        reason: reason ?? `Cancelled by ${actorType.toLowerCase()}`,
        data: { cancelledAt: now, cancelledById: actor.id, cancellationReason: reason ?? null },
        metadata: { refund: decision } as unknown as Prisma.InputJsonValue,
      });
      if (payment && decision.refundMinor > 0) {
        const refund = await tx.refund.create({
          data: {
            paymentId: payment.id,
            bookingId: b.id,
            amountMinor: decision.refundMinor,
            reason: `${decision.rule}: cancelled by ${actorType.toLowerCase()}`,
            initiatedById: actor.id,
          },
        });
        await this.outbox.publish(tx, { type: 'refund.requested', aggregateId: refund.id, payload: { refundId: refund.id } });
      }
      await this.outbox.publish(tx, {
        type: 'booking.cancelled',
        aggregateId: b.id,
        payload: { bookingId: b.id, actor: actorType, refundMinor: decision.refundMinor },
      });
      if (actorType === 'ADMIN')
        await this.audit.record({ actorId: actor.id, actorRole: 'ADMIN', action: 'admin.booking_cancelled', entityType: 'Booking', entityId: b.id, metadata: { refund: decision } as unknown as Prisma.InputJsonValue }, tx);
      return decision;
    });
    this.metrics.bookingEvents.inc({ event: 'cancelled' });
    return { booking: await this.view(actor, bookingId), refund: result };
  }

  async reschedule(actor: AuthUser, bookingId: string, newStartIso: string) {
    const booking = await this.loadAuthorized(actor, bookingId);
    const actorType: CancelActor = actor.role === 'ADMIN' ? 'ADMIN' : actor.role === 'TEACHER' ? 'TEACHER' : 'STUDENT';
    if (booking.status !== 'CONFIRMED')
      throw AppError.unprocessable(ErrorCode.BOOKING_INVALID_STATE, 'Only confirmed sessions can be rescheduled');
    const policy = (booking.policySnapshot as unknown as PolicySnapshot).reschedule;
    const check = rescheduleCheck({ startAt: booking.startAt, now: new Date(), rescheduleCount: booking.rescheduleCount, policy, actor: actorType });
    if (!check.allowed) throw AppError.unprocessable(ErrorCode.BOOKING_POLICY_VIOLATION, check.reason);

    const newStart = new Date(newStartIso);
    if (newStart.getTime() === booking.startAt.getTime())
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Choose a different time');
    const teacher = await this.prisma.teacherProfile.findUniqueOrThrow({ where: { id: booking.teacherId } });
    if (!(await this.availability.isBookable(teacher, newStart, booking.durationMinutes, booking.id)))
      throw AppError.conflict(ErrorCode.SLOT_UNAVAILABLE, 'That time is not available. Please pick another slot.');

    const newEnd = addMinutes(newStart, booking.durationMinutes);
    try {
      await this.prisma.$transaction(async (tx) => {
        const b = await this.lock(tx, booking.id);
        if (b.status !== 'CONFIRMED' || b.version !== booking.version)
          throw AppError.conflict(ErrorCode.BOOKING_INVALID_STATE, 'The booking changed while processing; please refresh');
        await tx.booking.update({
          where: { id: b.id },
          data: {
            startAt: newStart,
            endAt: newEnd,
            blockedUntil: addMinutes(newEnd, teacher.bufferMinutes),
            rescheduleCount: { increment: 1 },
            version: { increment: 1 },
          },
        });
        await tx.bookingStatusHistory.create({
          data: {
            bookingId: b.id,
            fromStatus: 'CONFIRMED',
            toStatus: 'CONFIRMED',
            actorId: actor.id,
            reason: `Rescheduled by ${actorType.toLowerCase()}`,
            metadata: { previousStartAt: b.startAt.toISOString(), newStartAt: newStart.toISOString() },
          },
        });
        await this.outbox.publish(tx, {
          type: 'booking.rescheduled',
          aggregateId: b.id,
          payload: { bookingId: b.id, previousStartAt: b.startAt.toISOString(), previousEndAt: b.endAt.toISOString() },
        });
      });
    } catch (err) {
      if (isExclusionViolation(err)) throw AppError.conflict(ErrorCode.SLOT_UNAVAILABLE, 'That time was just booked. Please pick another slot.');
      throw err;
    }
    this.metrics.bookingEvents.inc({ event: 'rescheduled' });
    return this.view(actor, bookingId);
  }

  /** Marks finished sessions COMPLETED (maintenance job). */
  async completeFinished(now = new Date()) {
    const due = await this.prisma.booking.findMany({
      where: { status: 'CONFIRMED', endAt: { lt: now } },
      select: { id: true, status: true },
      take: 500,
    });
    for (const b of due) {
      await this.prisma
        .$transaction((tx) => this.transition(tx, b, 'COMPLETED', { reason: 'Session ended', data: { completedAt: now } }))
        .catch((err) => this.logger.warn({ err, bookingId: b.id }, 'Could not complete booking'));
    }
    return due.length;
  }

  // ---- Queries ----

  /** Object-level authorization: the caller must be the student, the teacher, or an admin. 404 otherwise. */
  async loadAuthorized(user: AuthUser, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking || !this.canAccess(user, booking)) throw AppError.notFound('Booking');
    return booking;
  }

  canAccess(user: AuthUser, b: Pick<Booking, 'studentId' | 'teacherId'>) {
    return user.role === 'ADMIN' || b.studentId === user.id || (user.teacherProfileId !== null && b.teacherId === user.teacherProfileId);
  }

  viewerOf(user: AuthUser): Viewer {
    return user.role;
  }

  async view(user: AuthUser, bookingId: string) {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: BOOKING_INCLUDE });
    if (!b || !this.canAccess(user, b)) throw AppError.notFound('Booking');
    const history = await this.prisma.bookingStatusHistory.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
      select: { fromStatus: true, toStatus: true, reason: true, createdAt: true },
    });
    return { ...toBookingView(b, this.viewerOf(user)), history };
  }

  async list(user: AuthUser, q: ListBookingsQuery) {
    const now = new Date();
    const owner: Prisma.BookingWhereInput =
      user.role === 'TEACHER' ? { teacherId: user.teacherProfileId ?? '00000000-0000-0000-0000-000000000000' } : { studentId: user.id };
    const scope: Record<ListBookingsQuery['scope'], Prisma.BookingWhereInput> = {
      upcoming: { status: 'CONFIRMED', endAt: { gte: now } },
      past: { status: { in: ['COMPLETED', 'CONFIRMED'] }, endAt: { lt: now } },
      cancelled: { status: { in: ['CANCELLED', 'EXPIRED', 'PAYMENT_FAILED'] } },
      pending: { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
      all: {},
    };
    const where = { ...owner, ...scope[q.scope] };
    const orderBy: Prisma.BookingOrderByWithRelationInput = q.scope === 'upcoming' || q.scope === 'pending' ? { startAt: 'asc' } : { startAt: 'desc' };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, orderBy, skip: q.skip, take: q.pageSize, include: BOOKING_INCLUDE }),
      this.prisma.booking.count({ where }),
    ]);
    return { rows: rows.map((r) => toBookingView(r, this.viewerOf(user))), total };
  }

  async teacherCalendar(user: AuthUser, fromIso: string, toIso: string) {
    if (!user.teacherProfileId) throw AppError.forbidden();
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (to.getTime() - from.getTime() > 45 * 86_400_000)
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Range too large', HttpStatus.BAD_REQUEST);
    const rows = await this.prisma.booking.findMany({
      where: { teacherId: user.teacherProfileId, startAt: { lt: to }, endAt: { gt: from }, status: { in: ['CONFIRMED', 'COMPLETED', 'PENDING_PAYMENT'] } },
      orderBy: { startAt: 'asc' },
      include: BOOKING_INCLUDE,
    });
    return rows.filter((r) => r.status !== 'PENDING_PAYMENT' || (r.holdExpiresAt && r.holdExpiresAt > new Date())).map((r) => toBookingView(r, 'TEACHER'));
  }
}

export { InvalidTransitionError };
