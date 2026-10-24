import { bookAndPay, createTeacher, createTestApp, createUser, futureSlot, idem, TestContext } from '../helpers/test-app';

describe('Role-based access & object-level authorization', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('protects every admin endpoint from students and teachers', async () => {
    const student = await createUser(ctx, 'STUDENT');
    const teacher = await createTeacher(ctx);
    const admin = await createUser(ctx, 'ADMIN');
    const endpoints = ['/api/v1/admin/overview', '/api/v1/admin/users', '/api/v1/admin/payments', '/api/v1/admin/integrations/health', '/api/v1/admin/audit-logs', '/api/v1/admin/settings'];
    for (const path of endpoints) {
      expect((await ctx.http().get(path)).status).toBe(401);
      expect((await ctx.http().get(path).set(student.auth)).status).toBe(403);
      expect((await ctx.http().get(path).set(teacher.auth)).status).toBe(403);
      expect((await ctx.http().get(path).set(admin.auth)).status).toBe(200);
    }
  });

  it('hides bookings from unrelated students and teachers (404, no enumeration)', async () => {
    const teacher = await createTeacher(ctx);
    const owner = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, owner, teacher, futureSlot(20, 9));
    const otherStudent = await createUser(ctx, 'STUDENT');
    const otherTeacher = await createTeacher(ctx);
    expect((await ctx.http().get(`/api/v1/bookings/${bookingId}`).set(owner.auth)).status).toBe(200);
    expect((await ctx.http().get(`/api/v1/bookings/${bookingId}`).set(teacher.auth)).status).toBe(200);
    expect((await ctx.http().get(`/api/v1/bookings/${bookingId}`).set(otherStudent.auth)).status).toBe(404);
    expect((await ctx.http().get(`/api/v1/bookings/${bookingId}`).set(otherTeacher.auth)).status).toBe(404);
    expect((await ctx.http().post(`/api/v1/bookings/${bookingId}/cancel`).set(otherStudent.auth).send({})).status).toBe(404);
    expect((await ctx.http().get(`/api/v1/meetings/booking/${bookingId}`).set(otherTeacher.auth)).status).toBe(404);
  });

  it('only shows a teacher their own bookings and only lets students book', async () => {
    const teacher = await createTeacher(ctx);
    const res = await ctx.http().post('/api/v1/bookings').set(teacher.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(21, 9), durationMinutes: 60 });
    expect(res.status).toBe(403);
  });

  it('never trusts client-supplied prices or roles', async () => {
    const teacher = await createTeacher(ctx, { rateMinor: 120000 });
    const student = await createUser(ctx, 'STUDENT');
    const res = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(21, 11), durationMinutes: 60, totalMinor: 1 });
    expect(res.status).toBe(400); // forbidNonWhitelisted
    const reg = await ctx.http().post('/api/v1/auth/register').send({ email: `x${Date.now()}@t.local`, password: 'Password12345', fullName: 'Sneaky', role: 'ADMIN', acceptTerms: true });
    expect(reg.status).toBe(403); // no CSRF bootstrap
  });

  it('blocks unverified students from booking', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT', { verified: false });
    const res = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(21, 13), durationMinutes: 60 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('cuts off suspended users immediately', async () => {
    const student = await createUser(ctx, 'STUDENT');
    const admin = await createUser(ctx, 'ADMIN');
    expect((await ctx.http().get('/api/v1/auth/me').set(student.auth)).status).toBe(200);
    expect((await ctx.http().patch(`/api/v1/admin/users/${student.user.id}/status`).set(admin.auth).send({ status: 'SUSPENDED' })).status).toBe(200);
    expect((await ctx.http().get('/api/v1/auth/me').set(student.auth)).status).toBe(401);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.user_status_changed', entityId: student.user.id } })).toBe(1);
  });
});

describe('Idempotency keys', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('replays the original response for a retried request', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const key = idem();
    const body = { teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(22, 9), durationMinutes: 60 };
    const a = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', key).send(body);
    const b = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', key).send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.id).toBe(a.body.id);
    expect(await ctx.prisma.booking.count({ where: { studentId: student.user.id } })).toBe(1);
  });

  it('rejects key reuse with a different payload and requires a key', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const key = idem();
    await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', key).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(22, 11), durationMinutes: 60 });
    const reuse = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', key).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(22, 13), durationMinutes: 60 });
    expect(reuse.status).toBe(422);
    const missing = await ctx.http().post('/api/v1/bookings').set(student.auth).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(22, 15), durationMinutes: 60 });
    expect(missing.status).toBe(400);
  });

  it('serialises concurrent requests with the same key', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const key = idem();
    const body = { teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt: futureSlot(23, 9), durationMinutes: 60 };
    const results = await Promise.all(Array.from({ length: 5 }, () => ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', key).send(body)));
    const ok = results.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((r) => r.body.id)).size).toBe(1);
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(await ctx.prisma.booking.count({ where: { studentId: student.user.id } })).toBe(1);
  });
});
