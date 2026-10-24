import { bookAndPay, createTeacher, createTestApp, createUser, drainOutbox, futureSlot, idem, TestContext } from '../helpers/test-app';
import { EmailSenderService } from '../../src/modules/notifications/email-sender.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ReminderService } from '../../src/modules/notifications/reminder.service';
import { ReminderSchedulerService } from '../../src/modules/notifications/reminder-scheduler.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { JobQueueService } from '../../src/jobs/job-queue.service';
import { QUEUES } from '../../src/jobs/queues';

describe('Booking lifecycle, refunds and notifications', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('confirmation publishes notifications for both parties via the outbox and schedules reminders', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(40, 9));
    await drainOutbox(ctx);
    const notes = await ctx.prisma.notification.findMany({ where: { dedupeKey: { startsWith: `confirmed.${bookingId}` } } });
    expect(notes.map((n) => `${n.type}:${n.channel}`).sort()).toEqual([
      'booking_confirmed:EMAIL',
      'booking_confirmed:IN_APP',
      'teacher_new_booking:EMAIL',
      'teacher_new_booking:IN_APP',
    ]);
    const delayed = await ctx.app.get(JobQueueService).queue(QUEUES.reminders).getDelayed();
    expect(delayed.filter((j) => j.data.bookingId === bookingId).map((j) => j.data.offsetMinutes).sort()).toEqual([1440, 60].sort());
    // Calendar sync job enqueued + tracked for the ops dashboard
    expect(await ctx.prisma.jobRecord.count({ where: { entityId: bookingId, name: 'calendar.sync' } })).toBe(1);
    // Draining again does not duplicate anything
    await drainOutbox(ctx);
    expect(await ctx.prisma.notification.count({ where: { dedupeKey: { startsWith: `confirmed.${bookingId}` } } })).toBe(4);
  });

  it('email delivery retries transient failures and records the provider message id', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(40, 11));
    await drainOutbox(ctx);
    const email = await ctx.prisma.notification.findFirstOrThrow({ where: { dedupeKey: `confirmed.${bookingId}.${student.user.id}.EMAIL` } });
    const sender = ctx.app.get(EmailSenderService);
    ctx.email.failTimes = 1;
    await expect(sender.send(email.id, 1, false)).rejects.toThrow(/try again/);
    const afterFail = await ctx.prisma.notification.findUniqueOrThrow({ where: { id: email.id } });
    expect(afterFail.status).toBe('PENDING');
    expect(afterFail.attempts).toBe(1);
    expect(await sender.send(email.id, 2, false)).toBe('sent');
    const sent = await ctx.prisma.notification.findUniqueOrThrow({ where: { id: email.id } });
    expect(sent.status).toBe('SENT');
    expect(sent.providerMessageId).toMatch(/@fake\.smtp/);
    // a retried job after success never re-sends
    const count = ctx.email.sent.length;
    expect(await sender.send(email.id, 3, false)).toBe('already-done');
    expect(ctx.email.sent.length).toBe(count);
    const msg = ctx.email.sent.at(-1)!;
    expect(msg.html).toContain('Your session is confirmed');
    expect(msg.text).toContain('Physics');
  });

  it('permanent email failures are not retried and are visible as FAILED', async () => {
    const student = await createUser(ctx, 'STUDENT');
    await ctx.app.get(NotificationsService).notify({ userId: student.user.id, templateKey: 'verify_email', dedupeKey: `perm.${student.user.id}`, data: { user: { name: 'X' }, link: 'http://x' }, channels: ['EMAIL'] });
    const n = await ctx.prisma.notification.findFirstOrThrow({ where: { dedupeKey: `perm.${student.user.id}.EMAIL` } });
    ctx.email.permanentFail = true;
    await expect(ctx.app.get(EmailSenderService).send(n.id, 1, false)).rejects.toThrow(/550/);
    ctx.email.permanentFail = false;
    expect((await ctx.prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('FAILED');
  });

  it('respects notification preferences except for mandatory messages', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    await ctx.http().put('/api/v1/notifications/preferences').set(student.auth).send({ preferences: [{ channel: 'EMAIL', category: 'REMINDER', enabled: false }] });
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(41, 9));
    await ctx.app.get(ReminderService).send(bookingId, 60, (await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).startAt.toISOString());
    const reminderEmail = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: student.user.id, type: 'session_reminder', channel: 'EMAIL' } });
    expect(reminderEmail.status).toBe('SKIPPED');
    await drainOutbox(ctx);
    const confirmation = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: student.user.id, type: 'booking_confirmed', channel: 'EMAIL' } });
    expect(confirmation.status).not.toBe('SKIPPED'); // mandatory
  });

  it('stale reminders (after reschedule or cancellation) are no-ops; the sweeper repairs missed ones', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const start = new Date(Date.now() + 45 * 60_000);
    start.setUTCMinutes(start.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
    const { bookingId } = await bookAndPay(ctx, student, teacher, start.toISOString(), 30);
    const reminders = ctx.app.get(ReminderService);
    expect(await reminders.send(bookingId, 60, new Date(start.getTime() + 3_600_000).toISOString())).toBe(false);
    // Simulate a lost delayed job: confirmed long ago, 60-min reminder never sent.
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { confirmedAt: new Date(Date.now() - 86_400_000) } });
    expect(await reminders.sweep()).toBeGreaterThanOrEqual(1);
    expect(await ctx.prisma.notification.count({ where: { type: 'session_reminder', dedupeKey: { contains: bookingId } } })).toBeGreaterThan(0);
    const again = await reminders.sweep();
    const after = await ctx.prisma.notification.count({ where: { type: 'session_reminder', dedupeKey: { contains: bookingId } } });
    expect(again).toBe(0);
    expect(after).toBe(4); // 2 recipients × 2 channels, no duplicates
  });

  it('student cancellation inside the full-refund window refunds 100% end-to-end', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(42, 9));
    const res = await ctx.http().post(`/api/v1/bookings/${bookingId}/cancel`).set(student.auth).send({ reason: 'Exam moved' });
    expect(res.status).toBe(200);
    expect(res.body.refund.rule).toBe('FULL_WINDOW');
    const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { bookingId } });
    expect(refund.status).toBe('PENDING');
    // worker submits the refund to Razorpay
    expect(await ctx.app.get(PaymentsService).processRefund(refund.id)).toBe('submitted');
    expect(await ctx.app.get(PaymentsService).processRefund(refund.id)).toBe('polled'); // no second refund created
    expect(ctx.payments.refunds.size).toBeGreaterThan(0);
    const submitted = await ctx.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(submitted.status).toBe('SUBMITTED');
    // provider confirms via webhook
    const providerRefund = ctx.payments.refunds.get(submitted.providerRefundId!)!;
    const body = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { ...providerRefund, status: 'processed' } } } });
    await ctx.http().post('/api/v1/payments/razorpay/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', ctx.payments.webhookSignature(body)).set('X-Razorpay-Event-Id', idem()).send(body);
    const done = await ctx.prisma.refund.findUniqueOrThrow({ where: { id: refund.id }, include: { payment: true } });
    expect(done.status).toBe('PROCESSED');
    expect(done.payment.status).toBe('REFUNDED');
    expect(done.payment.refundedMinor).toBe(done.amountMinor);
    // cannot cancel twice
    expect((await ctx.http().post(`/api/v1/bookings/${bookingId}/cancel`).set(student.auth).send({})).status).toBe(422);
  });

  it('late student cancellation follows policy (no refund) while teacher cancellation refunds fully', async () => {
    const teacher = await createTeacher(ctx);
    const s1 = await createUser(ctx, 'STUDENT');
    const s2 = await createUser(ctx, 'STUDENT');
    const soon = new Date(Date.now() + 2 * 3_600_000);
    soon.setUTCMinutes(soon.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
    const a = await bookAndPay(ctx, s1, teacher, soon.toISOString(), 30);
    const r1 = await ctx.http().post(`/api/v1/bookings/${a.bookingId}/cancel`).set(s1.auth).send({});
    expect(r1.body.refund.refundMinor).toBe(0);
    const b = await bookAndPay(ctx, s2, teacher, futureSlot(43, 9));
    const r2 = await ctx.http().post(`/api/v1/bookings/${b.bookingId}/cancel`).set(teacher.auth).send({ reason: 'Unwell' });
    expect(r2.body.refund.rule).toBe('TEACHER_CANCELLED');
    expect(r2.body.refund.refundMinor).toBeGreaterThan(0);
  });

  it('reschedule moves the booking atomically, respects limits and re-plans reminders', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const other = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(44, 9));
    await bookAndPay(ctx, other, teacher, futureSlot(44, 12));
    // cannot move onto someone else's session
    const clash = await ctx.http().post(`/api/v1/bookings/${bookingId}/reschedule`).set(student.auth).set('Idempotency-Key', idem()).send({ startAt: futureSlot(44, 12) });
    expect(clash.status).toBe(409);
    const ok = await ctx.http().post(`/api/v1/bookings/${bookingId}/reschedule`).set(student.auth).set('Idempotency-Key', idem()).send({ startAt: futureSlot(44, 15) });
    expect(ok.status).toBe(200);
    expect(ok.body.startAt).toBe(new Date(futureSlot(44, 15)).toISOString());
    expect(ok.body.rescheduleCount).toBe(1);
    // the original slot is free again for others
    const slots = await ctx.http().get(`/api/v1/availability/teachers/${teacher.profile.id}/slots`).query({ from: futureSlot(44, 8), to: futureSlot(44, 11), durationMinutes: 60 });
    expect(slots.body.slots.map((s: { startAt: string }) => s.startAt)).toContain(new Date(futureSlot(44, 9)).toISOString());
    await drainOutbox(ctx);
    const b = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const plans = await ctx.app.get(ReminderSchedulerService).schedule(b);
    expect(plans.every((p) => p.key.includes(String(b.startAt.getTime())))).toBe(true);
    await ctx.http().post(`/api/v1/bookings/${bookingId}/reschedule`).set(student.auth).set('Idempotency-Key', idem()).send({ startAt: futureSlot(45, 9) });
    const third = await ctx.http().post(`/api/v1/bookings/${bookingId}/reschedule`).set(student.auth).set('Idempotency-Key', idem()).send({ startAt: futureSlot(45, 15) });
    expect(third.status).toBe(422); // max 2 reschedules
  });

  it('teachers and students both see the confirmed booking in their lists', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(46, 9));
    const s = await ctx.http().get('/api/v1/bookings?scope=upcoming').set(student.auth);
    const t = await ctx.http().get('/api/v1/bookings?scope=upcoming').set(teacher.auth);
    expect(s.body.data.map((b: { id: string }) => b.id)).toContain(bookingId);
    expect(t.body.data.map((b: { id: string }) => b.id)).toContain(bookingId);
    expect(t.body.data[0].student.name).toBeDefined();
    const ics = await ctx.http().get(`/api/v1/bookings/${bookingId}/ics`).set(student.auth);
    expect(ics.text).toContain('BEGIN:VEVENT');
  });
});
