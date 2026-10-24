import { createTeacher, createTestApp, createUser, futureSlot, idem, TestContext } from '../helpers/test-app';

describe('Booking concurrency & double-booking prevention', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('lets exactly one of 25 concurrent students reserve the same slot', async () => {
    const teacher = await createTeacher(ctx);
    const students = await Promise.all(Array.from({ length: 25 }, () => createUser(ctx, 'STUDENT')));
    const startAt = futureSlot(3, 9);
    const results = await Promise.all(
      students.map((s) =>
        ctx.http().post('/api/v1/bookings').set(s.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt, durationMinutes: 60 }),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(24);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('SLOT_UNAVAILABLE');
    const holding = await ctx.prisma.booking.count({ where: { teacherId: teacher.profile.id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } } });
    expect(holding).toBe(1);
  });

  it('rejects overlapping (not just identical) slots, including the buffer', async () => {
    const teacher = await createTeacher(ctx, { buffer: 15 });
    const [a, b, c] = await Promise.all([createUser(ctx, 'STUDENT'), createUser(ctx, 'STUDENT'), createUser(ctx, 'STUDENT')]);
    const body = (startAt: string, durationMinutes = 60) => ({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt, durationMinutes });
    expect((await ctx.http().post('/api/v1/bookings').set(a.auth).set('Idempotency-Key', idem()).send(body(futureSlot(4, 10)))).status).toBe(201);
    // 10:30 overlaps 10:00-11:00
    expect((await ctx.http().post('/api/v1/bookings').set(b.auth).set('Idempotency-Key', idem()).send(body(futureSlot(4, 10, 30), 30))).status).toBe(409);
    // 11:00 is inside the 15-minute buffer after 11:00 → blocked
    expect((await ctx.http().post('/api/v1/bookings').set(b.auth).set('Idempotency-Key', idem()).send(body(futureSlot(4, 11), 30))).status).toBe(409);
    // 9:30-10:00 would run its own buffer into 10:00 → blocked
    expect((await ctx.http().post('/api/v1/bookings').set(c.auth).set('Idempotency-Key', idem()).send(body(futureSlot(4, 9, 30), 30))).status).toBe(409);
    // 11:30 is free
    expect((await ctx.http().post('/api/v1/bookings').set(c.auth).set('Idempotency-Key', idem()).send(body(futureSlot(4, 11, 30), 30))).status).toBe(201);
  });

  it('enforces the guarantee in the database even if application checks are bypassed', async () => {
    const teacher = await createTeacher(ctx);
    const [s1, s2] = await Promise.all([createUser(ctx, 'STUDENT'), createUser(ctx, 'STUDENT')]);
    const start = new Date(futureSlot(5, 8));
    const row = (studentId: string, offsetMin: number) => ({
      studentId,
      teacherId: teacher.profile.id,
      subjectId: teacher.subject.id,
      startAt: new Date(start.getTime() + offsetMin * 60_000),
      endAt: new Date(start.getTime() + (offsetMin + 60) * 60_000),
      blockedUntil: new Date(start.getTime() + (offsetMin + 70) * 60_000),
      durationMinutes: 60,
      studentTimezone: 'UTC',
      teacherTimezone: 'UTC',
      status: 'CONFIRMED' as const,
      priceMinor: 100,
      totalMinor: 100,
      policySnapshot: {},
    });
    await ctx.prisma.booking.create({ data: row(s1.user.id, 0) });
    await expect(ctx.prisma.booking.create({ data: row(s2.user.id, 30) })).rejects.toThrow(/booking_no_overlap|exclusion/i);
  });

  it('frees the slot when a hold expires, without a background job', async () => {
    const teacher = await createTeacher(ctx);
    const [s1, s2] = await Promise.all([createUser(ctx, 'STUDENT'), createUser(ctx, 'STUDENT')]);
    const startAt = futureSlot(6, 12);
    const body = { teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt, durationMinutes: 60 };
    const first = await ctx.http().post('/api/v1/bookings').set(s1.auth).set('Idempotency-Key', idem()).send(body);
    expect(first.status).toBe(201);
    expect((await ctx.http().post('/api/v1/bookings').set(s2.auth).set('Idempotency-Key', idem()).send(body)).status).toBe(409);
    await ctx.prisma.booking.update({ where: { id: first.body.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const second = await ctx.http().post('/api/v1/bookings').set(s2.auth).set('Idempotency-Key', idem()).send(body);
    expect(second.status).toBe(201);
    expect((await ctx.prisma.booking.findUnique({ where: { id: first.body.id } }))!.status).toBe('EXPIRED');
  });

  it('prevents a student from double-booking themselves across teachers', async () => {
    const [t1, t2] = [await createTeacher(ctx), await createTeacher(ctx)];
    const s = await createUser(ctx, 'STUDENT');
    const startAt = futureSlot(7, 14);
    expect((await ctx.http().post('/api/v1/bookings').set(s.auth).set('Idempotency-Key', idem()).send({ teacherId: t1.profile.id, subjectId: t1.subject.id, startAt, durationMinutes: 60 })).status).toBe(201);
    const res = await ctx.http().post('/api/v1/bookings').set(s.auth).set('Idempotency-Key', idem()).send({ teacherId: t2.profile.id, subjectId: t2.subject.id, startAt, durationMinutes: 60 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/already have a session/);
  });

  it('rejects slots outside working hours, unknown durations and the past', async () => {
    const teacher = await createTeacher(ctx);
    await ctx.prisma.teacherAvailability.deleteMany({ where: { teacherId: teacher.profile.id } });
    await ctx.prisma.teacherAvailability.create({ data: { teacherId: teacher.profile.id, dayOfWeek: 1, startMinute: 600, endMinute: 660 } });
    const s = await createUser(ctx, 'STUDENT');
    const send = (startAt: string, durationMinutes = 60) =>
      ctx.http().post('/api/v1/bookings').set(s.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt, durationMinutes });
    expect((await send(futureSlot(2, 3))).status).toBe(409);
    expect((await send(futureSlot(2, 3), 45)).status).toBe(422);
    expect((await send(new Date(Date.now() - 3_600_000).toISOString())).status).toBe(409);
  });
});
