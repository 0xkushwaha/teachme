import { bookAndPay, createTeacher, createTestApp, createUser, futureSlot, idem, TestContext } from '../helpers/test-app';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { BookingsService } from '../../src/modules/bookings/bookings.service';

describe('Razorpay payment verification & webhooks', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  async function reserve(day: number, hour: number) {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const res = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(day, hour), durationMinutes: 60 });
    const order = await ctx.http().post('/api/v1/payments/orders').set(student.auth).set('Idempotency-Key', idem()).send({ bookingId: res.body.id });
    return { teacher, student, bookingId: res.body.id as string, order: order.body };
  }

  function webhook(event: string, entity: Record<string, unknown>, eventId = idem()) {
    const body = JSON.stringify({ event, payload: { [event.split('.')[0]]: { entity } }, created_at: Math.floor(Date.now() / 1000) });
    return ctx.http().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', ctx.payments.webhookSignature(body)).set('X-Razorpay-Event-Id', eventId).send(body);
  }

  it('creates an order for the server-computed amount and exposes only public fields', async () => {
    const { order, bookingId } = await reserve(10, 9);
    const booking = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(order.amountMinor).toBe(booking.totalMinor);
    expect(order.keyId).toBe('rzp_test_fakekey');
    expect(JSON.stringify(order)).not.toMatch(/secret/i);
  });

  it('reuses the existing order on retry instead of creating a second one', async () => {
    const { student, bookingId, order } = await reserve(10, 11);
    const again = await ctx.http().post('/api/v1/payments/orders').set(student.auth).set('Idempotency-Key', idem()).send({ bookingId });
    expect(again.body.orderId).toBe(order.orderId);
  });

  it('confirms the booking only after server-side verification', async () => {
    const { student, bookingId, order } = await reserve(10, 13);
    const paid = ctx.payments.pay(order.orderId);
    const res = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send({ bookingId, razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature });
    expect(res.body.outcome).toBe('confirmed');
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { payments: true } });
    expect(b.status).toBe('CONFIRMED');
    expect(b.payments[0].status).toBe('CAPTURED');
    expect(await ctx.prisma.outboxEvent.count({ where: { type: 'booking.confirmed', aggregateId: bookingId } })).toBe(1);
  });

  it('rejects a forged signature and leaves the booking pending', async () => {
    const { student, bookingId, order } = await reserve(10, 15);
    const paid = ctx.payments.pay(order.orderId);
    const res = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send({ bookingId, razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('PENDING_PAYMENT');
  });

  it('does not let another student verify someone else\'s payment', async () => {
    const { bookingId, order } = await reserve(10, 17);
    const other = await createUser(ctx, 'STUDENT');
    const paid = ctx.payments.pay(order.orderId);
    const res = await ctx.http().post('/api/v1/payments/razorpay/verify').set(other.auth).send({ bookingId, razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature });
    expect(res.status).toBe(404);
  });

  it('is idempotent across checkout callback, duplicate webhooks and replays (one payment → one booking)', async () => {
    const { student, bookingId, order } = await reserve(11, 9);
    const paid = ctx.payments.pay(order.orderId);
    const eventId = `evt_${idem()}`;
    const verifyBody = { bookingId, razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature };
    const [v1, v2] = await Promise.all([
      ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send(verifyBody),
      webhook('payment.captured', paid.payment as unknown as Record<string, unknown>, eventId),
    ]);
    expect([v1.body.outcome, v2.body.result].sort()).toEqual(['already_confirmed', 'confirmed']);
    const dup = await webhook('payment.captured', paid.payment as unknown as Record<string, unknown>, eventId);
    expect(dup.body.status).toBe('duplicate');
    const v3 = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send(verifyBody);
    expect(v3.body.outcome).toBe('already_confirmed');
    expect(await ctx.prisma.outboxEvent.count({ where: { type: 'booking.confirmed', aggregateId: bookingId } })).toBe(1);
    expect(await ctx.prisma.bookingStatusHistory.count({ where: { bookingId, toStatus: 'CONFIRMED' } })).toBe(1);
  });

  it('rejects webhooks with an invalid signature', async () => {
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });
    const res = await ctx.http().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'deadbeef').send(body);
    expect(res.status).toBe(400);
  });

  it('confirms via webhook alone when the browser never returns (abandoned tab)', async () => {
    const { bookingId, order } = await reserve(11, 11);
    const paid = ctx.payments.pay(order.orderId);
    const res = await webhook('payment.captured', paid.payment as unknown as Record<string, unknown>);
    expect(res.body.result).toBe('confirmed');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
  });

  it('handles out-of-order events: a late payment.failed never downgrades a capture', async () => {
    const { bookingId, order } = await reserve(11, 13);
    const failedAttempt = ctx.payments.pay(order.orderId, { status: 'failed' });
    const success = ctx.payments.pay(order.orderId);
    await webhook('payment.captured', success.payment as unknown as Record<string, unknown>);
    await webhook('payment.failed', failedAttempt.payment as unknown as Record<string, unknown>);
    const p = await ctx.prisma.payment.findFirstOrThrow({ where: { bookingId } });
    expect(p.status).toBe('CAPTURED');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
  });

  it('records failed attempts without cancelling the hold, so the student can retry', async () => {
    const { student, bookingId, order } = await reserve(11, 15);
    const failed = ctx.payments.pay(order.orderId, { status: 'failed' });
    const r = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send({ bookingId, razorpay_order_id: failed.razorpay_order_id, razorpay_payment_id: failed.razorpay_payment_id, razorpay_signature: failed.razorpay_signature });
    expect(r.body.outcome).toBe('failed');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('PENDING_PAYMENT');
    const retry = ctx.payments.pay(order.orderId);
    const r2 = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send({ bookingId, razorpay_order_id: retry.razorpay_order_id, razorpay_payment_id: retry.razorpay_payment_id, razorpay_signature: retry.razorpay_signature });
    expect(r2.body.outcome).toBe('confirmed');
  });

  it('flags amount mismatches as discrepancies instead of confirming', async () => {
    const { bookingId, order } = await reserve(11, 17);
    const tampered = ctx.payments.pay(order.orderId, { amount: 100 });
    const res = await webhook('payment.captured', tampered.payment as unknown as Record<string, unknown>);
    expect(res.body.result).toBe('mismatch');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('PENDING_PAYMENT');
    expect((await ctx.prisma.payment.findFirstOrThrow({ where: { bookingId } })).discrepancy).toMatch(/MISMATCH/);
  });

  it('refunds in full when payment arrives after the hold expired and the slot was taken', async () => {
    const { teacher, student, bookingId, order } = await reserve(12, 9);
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const rival = await createUser(ctx, 'STUDENT');
    const taken = await ctx.http().post('/api/v1/bookings').set(rival.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(12, 9), durationMinutes: 60 });
    expect(taken.status).toBe(201);
    const paid = ctx.payments.pay(order.orderId);
    const res = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send({ bookingId, razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature });
    expect(res.body.outcome).toBe('conflict_refunded');
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { refunds: true, payments: true } });
    expect(b.status).toBe('EXPIRED');
    expect(b.payments[0].status).toBe('CAPTURED');
    expect(b.refunds).toHaveLength(1);
    expect(b.refunds[0].amountMinor).toBe(b.totalMinor);
  });

  it('confirms a late payment when the slot is still free (EXPIRED → CONFIRMED)', async () => {
    const { student, bookingId, order } = await reserve(12, 11);
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const bookings = ctx.app.get(BookingsService);
    await ctx.prisma.$transaction((tx) => bookings.expireStaleHolds(tx));
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('EXPIRED');
    const paid = ctx.payments.pay(order.orderId);
    const res = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send({ bookingId, razorpay_order_id: paid.razorpay_order_id, razorpay_payment_id: paid.razorpay_payment_id, razorpay_signature: paid.razorpay_signature });
    expect(res.body.outcome).toBe('confirmed');
  });

  it('reconciliation settles payments whose callback and webhook were both lost', async () => {
    const { bookingId, order } = await reserve(12, 13);
    ctx.payments.pay(order.orderId);
    await ctx.prisma.payment.updateMany({ where: { bookingId }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    await ctx.app.get(PaymentsService).reconcile();
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
  });

  it('keeps a booking pending when order creation fails at the provider', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const res = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(12, 15), durationMinutes: 60 });
    ctx.payments.failCreateOrder = true;
    const order = await ctx.http().post('/api/v1/payments/orders').set(student.auth).set('Idempotency-Key', idem()).send({ bookingId: res.body.id });
    ctx.payments.failCreateOrder = false;
    expect(order.status).toBe(502);
    expect(await ctx.prisma.payment.count({ where: { bookingId: res.body.id } })).toBe(0);
  });

  it('bookAndPay helper produces a confirmed booking', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(13, 9));
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
  });
});
