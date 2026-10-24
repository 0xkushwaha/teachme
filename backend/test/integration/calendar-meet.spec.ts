import { bookAndPay, createTeacher, createTestApp, createUser, futureSlot, TestContext } from '../helpers/test-app';
import { CalendarSyncService, googleEventId } from '../../src/modules/calendar/calendar-sync.service';
import { CalendarProviderError } from '../../src/integrations/google/calendar-gateway';
import { encrypt } from '../../src/utils/crypto';
import { TEST_ENV } from './test-env';

describe('Google Calendar & Meet integration (adapter boundary)', () => {
  let ctx: TestContext;
  let sync: CalendarSyncService;
  beforeAll(async () => {
    ctx = await createTestApp();
    sync = ctx.app.get(CalendarSyncService);
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    ctx.calendar.revoked = false;
    ctx.calendar.meetOnInsert = 'pending';
  });

  async function connected() {
    const teacher = await createTeacher(ctx);
    await ctx.prisma.calendarConnection.create({
      data: { userId: teacher.user.id, encryptedRefreshToken: encrypt('1//refresh', TEST_ENV.DATA_ENCRYPTION_KEY), scopes: ['https://www.googleapis.com/auth/calendar.events'] },
    });
    return teacher;
  }

  it('does not fabricate a meeting when the teacher has not connected Google', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(30, 9));
    expect(await sync.sync(bookingId)).toBe('teacher_not_connected');
    const m = await ctx.prisma.meeting.findUniqueOrThrow({ where: { bookingId } });
    expect(m.status).toBe('NOT_CONFIGURED');
    expect(m.joinUrl).toBeNull();
  });

  it('creates one event with a deterministic id and resolves an async Meet conference', async () => {
    const teacher = await connected();
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(30, 11));
    const before = ctx.calendar.inserts;
    expect(await sync.sync(bookingId)).toBe('synced');
    expect(await sync.sync(bookingId)).toBe('synced'); // retry: no duplicate
    expect(ctx.calendar.inserts - before).toBe(1);
    expect(ctx.calendar.events.has(googleEventId(bookingId))).toBe(true);
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { bookingId } })).status).toBe('PENDING');

    await sync.pollMeet(bookingId, 1);
    const m = await ctx.prisma.meeting.findUniqueOrThrow({ where: { bookingId } });
    expect(m.status).toBe('READY');
    expect(m.joinUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    // participants were notified once
    expect(await ctx.prisma.notification.count({ where: { type: 'meet_ready', channel: 'IN_APP', dedupeKey: { contains: bookingId } } })).toBe(2);
  });

  it('marks failed conferences and supports a safe retry with a new request id', async () => {
    const teacher = await connected();
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(30, 13));
    ctx.calendar.meetOnInsert = 'failure';
    await sync.sync(bookingId);
    const failed = await ctx.prisma.meeting.findUniqueOrThrow({ where: { bookingId } });
    expect(failed.status).toBe('FAILED');

    const retry = await ctx.http().post(`/api/v1/meetings/booking/${bookingId}/retry`).set(teacher.auth);
    expect(retry.status).toBe(202);
    const reset = await ctx.prisma.meeting.findUniqueOrThrow({ where: { bookingId } });
    expect(reset.conferenceRequestId).not.toBe(failed.conferenceRequestId);
    ctx.calendar.meetOnInsert = 'success';
    await sync.sync(bookingId);
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { bookingId } })).status).toBe('READY');
    // a student may not trigger retries
    expect((await ctx.http().post(`/api/v1/meetings/booking/${bookingId}/retry`).set(student.auth)).status).toBe(403);
  });

  it('flags revoked Google access, alerts the teacher and stops retrying', async () => {
    const teacher = await connected();
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(30, 15));
    ctx.calendar.revoked = true;
    await expect(sync.sync(bookingId)).rejects.toThrow(/revoked/i);
    const conn = await ctx.prisma.calendarConnection.findFirstOrThrow({ where: { userId: teacher.user.id } });
    expect(conn.status).toBe('REVOKED');
    expect(await ctx.prisma.notification.count({ where: { userId: teacher.user.id, type: 'calendar_reconnect' } })).toBeGreaterThan(0);
    const status = await ctx.http().get('/api/v1/integrations/google/status').set(teacher.auth);
    expect(status.body.connection.status).toBe('REVOKED');
  });

  it('retries transient Google errors without corrupting the booking', async () => {
    const teacher = await connected();
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(31, 9));
    ctx.calendar.failNext = new CalendarProviderError('Backend Error', 503);
    await expect(sync.sync(bookingId)).rejects.toThrow('Backend Error');
    expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe('CONFIRMED');
    expect(await sync.sync(bookingId)).toBe('synced');
  });

  it('updates the event on reschedule and deletes it on cancellation', async () => {
    const teacher = await connected();
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(32, 9));
    ctx.calendar.meetOnInsert = 'success';
    await sync.sync(bookingId);
    const newStart = futureSlot(32, 12);
    const r = await ctx.http().post(`/api/v1/bookings/${bookingId}/reschedule`).set(student.auth).set('Idempotency-Key', `rs-${bookingId}`).send({ startAt: newStart });
    expect(r.status).toBe(200);
    await sync.sync(bookingId);
    expect(ctx.calendar.events.get(googleEventId(bookingId))!.startIso).toBe(new Date(newStart).toISOString());
    await ctx.http().post(`/api/v1/bookings/${bookingId}/cancel`).set(student.auth).send({ reason: 'Change of plans' });
    expect(await sync.cancel(bookingId)).toBe('cancelled');
    expect(ctx.calendar.events.get(googleEventId(bookingId))!.cancelled).toBe(true);
    expect((await ctx.prisma.meeting.findUniqueOrThrow({ where: { bookingId } })).status).toBe('CANCELLED');
  });

  it('OAuth callback rejects a state that does not match the browser cookie', async () => {
    const teacher = await createTeacher(ctx);
    const start = await ctx.http().post('/api/v1/integrations/google/connect').set(teacher.auth);
    expect(start.status).toBe(200);
    const state = new URL(start.body.url).searchParams.get('state')!;
    const bad = await ctx.http().get(`/api/v1/integrations/google/callback?code=abc&state=${state}`).set('Cookie', 'tm_oauth_state=someone-elses');
    expect(bad.headers.location).toContain('google=error');
    const good = await ctx.http().get(`/api/v1/integrations/google/callback?code=abc&state=${state}`).set('Cookie', `tm_oauth_state=${state}`);
    expect(good.headers.location).toContain('google=connected');
    const conn = await ctx.prisma.calendarConnection.findFirstOrThrow({ where: { userId: teacher.user.id } });
    expect(conn.encryptedRefreshToken).not.toContain('fake-refresh');
    // state is single-use
    const replay = await ctx.http().get(`/api/v1/integrations/google/callback?code=abc&state=${state}`).set('Cookie', `tm_oauth_state=${state}`);
    expect(replay.headers.location).toContain('google=error');
  });
});
