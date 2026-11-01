import { randomUUID } from 'crypto';
import { RedisService } from '../../src/services/redis.service';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { EmailSenderService } from '../../src/modules/notifications/email-sender.service';
import { bookAndPay, createTeacher, createTestApp, createUser, drainOutbox, futureSlot, TestContext } from '../helpers/test-app';

const API = '/api/v1';
const ORIGIN = 'http://localhost:3000';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

/** Drains the outbox, then delivers queued email notifications for these users (no queue workers in tests). */
async function deliverEmails(ctx: TestContext, ...userIds: string[]) {
  await drainOutbox(ctx);
  const pending = await ctx.prisma.notification.findMany({ where: { userId: { in: userIds }, channel: 'EMAIL', status: 'PENDING' } });
  for (const n of pending) await ctx.app.get(EmailSenderService).send(n.id, 1, true);
}

let seq = 0;
const email = () => `invitee-${Date.now().toString(36)}-${++seq}@test.local`;

/** Cookie-based anonymous client with the CSRF double-submit token bootstrapped. */
let clientIp = 0;
async function browser(ctx: TestContext) {
  const agent = ctx.http();
  // Each simulated browser is a distinct client, so per-IP route limits apply per test client.
  const ip = `10.77.${Math.floor(++clientIp / 250) % 250}.${(clientIp % 250) + 1}`;
  const csrf = (await agent.get(`${API}/auth/csrf`).set('X-Forwarded-For', ip)).body.csrfToken as string;
  const post = (path: string, body: unknown) => agent.post(`${API}${path}`).set('X-Forwarded-For', ip).set('x-csrf-token', csrf).set('Origin', ORIGIN).send(body as object);
  return { agent, post };
}

async function lastInviteToken(ctx: TestContext, to: string) {
  await drainOutbox(ctx);
  const msg = [...ctx.email.sent].reverse().find((m) => m.to === to && m.subject.includes('invited'));
  const token = msg?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`no invitation email for ${to}`);
  return token;
}

async function acceptInvite(ctx: TestContext, token: string, fullName = 'Invited Teacher') {
  const b = await browser(ctx);
  return b.post('/auth/invitations/accept', { token, fullName, password: 'Teacher-Pass123', acceptTerms: true, timezone: 'UTC' });
}

/** A PENDING teacher with a complete profile, one subject and availability, but no documents. */
async function pendingTeacher(ctx: TestContext) {
  const approved = await createTeacher(ctx); // provides the shared subject
  const t = await createUser(ctx, 'TEACHER');
  const profile = await ctx.prisma.teacherProfile.create({
    data: {
      userId: t.user.id,
      slug: `pending-${randomUUID().slice(0, 8)}`,
      headline: 'Physics teacher applying for review',
      bio: 'A biography that is comfortably longer than fifty characters for the application checks.',
      languages: ['English'],
      timezone: 'UTC',
      approvalStatus: 'PENDING',
      subjects: { create: { subjectId: approved.subject.id, hourlyRateMinor: 90000 } },
      availability: { create: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }] },
    },
  });
  return { ...t, profile };
}

const upload = (ctx: TestContext, auth: Record<string, string>, buf: Buffer, filename: string, contentType: string, fields = { type: 'DEGREE', title: 'B.Sc. Physics' }) =>
  ctx.http().post(`${API}/teachers/me/documents`).set(auth).field('type', fields.type).field('title', fields.title).attach('file', buf, { filename, contentType });

describe('Teacher invitations', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('invites, emails a single-use link and creates a verified PENDING teacher on acceptance', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const to = email();
    const inv = await ctx.http().post(`${API}/admin/invitations`).set(admin.auth).send({ email: to.toUpperCase() });
    expect(inv.status).toBe(201);
    expect(inv.body.email).toBe(to);
    expect(inv.body).not.toHaveProperty('tokenHash');

    const token = await lastInviteToken(ctx, to);
    const stored = await ctx.prisma.teacherInvitation.findUniqueOrThrow({ where: { id: inv.body.id } });
    expect(stored.tokenHash).not.toContain(token); // only the hash is stored
    expect(stored.deliveredAt).not.toBeNull();

    const b = await browser(ctx);
    const inspect = await b.post('/auth/invitations/inspect', { token });
    expect(inspect.status).toBe(200);
    expect(inspect.body.email).toBe(to);

    const accepted = await acceptInvite(ctx, token);
    expect(accepted.status).toBe(201);
    expect(accepted.body.user).toMatchObject({ email: to, role: 'TEACHER', emailVerified: true, teacherProfile: { approvalStatus: 'PENDING' } });
    expect(String(accepted.headers['set-cookie'])).toContain('tm_at=');

    const reuse = await acceptInvite(ctx, token, 'Second Try');
    expect(reuse.status).toBe(400);
    expect(reuse.body.error.code).toBe('TOKEN_INVALID');
    expect((await ctx.prisma.teacherInvitation.findUniqueOrThrow({ where: { id: inv.body.id } })).status).toBe('ACCEPTED');
    expect(await ctx.prisma.user.count({ where: { email: to } })).toBe(1);

    await deliverEmails(ctx, accepted.body.user.id);
    expect(ctx.email.sent.some((m) => m.to === to && m.subject.includes('Welcome to TeachMe'))).toBe(true);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.teacher_invited', entityId: inv.body.id } })).toBe(1);
  });

  it('lets exactly one of many concurrent acceptances win', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const to = email();
    await ctx.http().post(`${API}/admin/invitations`).set(admin.auth).send({ email: to });
    const token = await lastInviteToken(ctx, to);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => acceptInvite(ctx, token, `Racer ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400 || r.status === 409)).toHaveLength(5);
    expect(await ctx.prisma.user.count({ where: { email: to } })).toBe(1);
  });

  it('prevents duplicate invitations and invitations for existing accounts', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const to = email();
    expect((await ctx.http().post(`${API}/admin/invitations`).set(admin.auth).send({ email: to })).status).toBe(201);
    const dup = await ctx.http().post(`${API}/admin/invitations`).set(admin.auth).send({ email: to });
    expect(dup.status).toBe(409);
    const student = await createUser(ctx, 'STUDENT');
    const existing = await ctx.http().post(`${API}/admin/invitations`).set(admin.auth).send({ email: student.user.email });
    expect(existing.status).toBe(409);
    expect(existing.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('resend rotates the token; revoke and expiry invalidate links', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const to = email();
    const inv = await ctx.http().post(`${API}/admin/invitations`).set(admin.auth).send({ email: to });
    const first = await lastInviteToken(ctx, to);

    expect((await ctx.http().post(`${API}/admin/invitations/${inv.body.id}/resend`).set(admin.auth)).status).toBe(429); // cooldown
    await ctx.prisma.teacherInvitation.update({ where: { id: inv.body.id }, data: { lastSentAt: new Date(Date.now() - 120_000) } });
    const resent = await ctx.http().post(`${API}/admin/invitations/${inv.body.id}/resend`).set(admin.auth);
    expect(resent.status).toBe(200);
    expect(resent.body.sendCount).toBe(2);
    const second = await lastInviteToken(ctx, to);
    expect(second).not.toBe(first);
    const b = await browser(ctx);
    expect((await b.post('/auth/invitations/inspect', { token: first })).status).toBe(400);
    expect((await b.post('/auth/invitations/inspect', { token: second })).status).toBe(200);

    expect((await ctx.http().post(`${API}/admin/invitations/${inv.body.id}/revoke`).set(admin.auth)).status).toBe(200);
    expect((await acceptInvite(ctx, second)).status).toBe(400);

    const to2 = email();
    const inv2 = await ctx.http().post(`${API}/admin/invitations`).set(admin.auth).send({ email: to2 });
    const t2 = await lastInviteToken(ctx, to2);
    await ctx.prisma.teacherInvitation.update({ where: { id: inv2.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await acceptInvite(ctx, t2)).status).toBe(400);
    const listed = await ctx.http().get(`${API}/admin/invitations`).query({ status: 'EXPIRED', q: to2 }).set(admin.auth);
    expect(listed.body.data[0]).toMatchObject({ id: inv2.body.id, status: 'EXPIRED' });
  });

  it('restricts invitations to admins and closes open teacher sign-up by default', async () => {
    const student = await createUser(ctx, 'STUDENT');
    const teacher = await createTeacher(ctx);
    expect((await ctx.http().post(`${API}/admin/invitations`).set(student.auth).send({ email: email() })).status).toBe(403);
    expect((await ctx.http().post(`${API}/admin/invitations`).set(teacher.auth).send({ email: email() })).status).toBe(403);
    expect((await ctx.http().get(`${API}/admin/invitations`)).status).toBe(401);

    const b = await browser(ctx);
    const reg = await b.post('/auth/register', { email: email(), password: 'Password12345', fullName: 'Self Signup', role: 'TEACHER', acceptTerms: true });
    expect(reg.status).toBe(403);
    expect(reg.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('Teacher application, documents and approval', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('validates uploads by content and size', async () => {
    const t = await pendingTeacher(ctx);
    const spoofed = await upload(ctx, t.auth, Buffer.from('<html><script>alert(1)</script></html>'), 'degree.pdf', 'application/pdf');
    expect(spoofed.status).toBe(400);
    const polyglot = await upload(ctx, t.auth, Buffer.concat([PNG, Buffer.from('<script>alert(1)</script>')]), 'photo.png', 'image/png');
    expect(polyglot.status).toBe(400);
    const big = await upload(ctx, t.auth, Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'big.pdf', 'application/pdf');
    expect(big.status).toBe(413);
    const badType = await upload(ctx, t.auth, PDF, 'x.pdf', 'application/pdf', { type: 'PASSPORT_SCAN', title: 'x' });
    expect(badType.status).toBe(400);
    expect(await ctx.prisma.teacherDocument.count({ where: { teacherId: t.profile.id } })).toBe(0);
    expect((await ctx.http().post(`${API}/teachers/me/avatar`).set(t.auth).attach('file', PDF, { filename: 'me.png', contentType: 'image/png' })).status).toBe(400);
  });

  it('runs submit → reject with reason → resubmit → approve, with documents only visible to owner and admins', async () => {
    const t = await pendingTeacher(ctx);
    const other = await pendingTeacher(ctx);
    const admin = await createUser(ctx, 'ADMIN');
    const student = await createUser(ctx, 'STUDENT');

    const early = await ctx.http().post(`${API}/teachers/me/application/submit`).set(t.auth);
    expect(early.status).toBe(422);
    expect(early.body.error.details.missing).toEqual(['documents']);
    expect((await ctx.http().post(`${API}/admin/teachers/${t.profile.id}/approval`).set(admin.auth).send({ status: 'APPROVED' })).status).toBe(422);

    const doc = await upload(ctx, t.auth, PDF, '../../degree.pdf', 'application/octet-stream');
    expect(doc.status).toBe(201);
    expect(doc.body).toMatchObject({ type: 'DEGREE', reviewStatus: 'PENDING', file: { mimeType: 'application/pdf', fileName: 'degree.pdf' } });
    expect(doc.body.file).not.toHaveProperty('data');

    const own = await ctx.http().get(`${API}/teachers/me/documents/${doc.body.id}/file`).set(t.auth);
    expect(own.status).toBe(200);
    expect(own.headers['content-disposition']).toMatch(/^attachment/);
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect((await ctx.http().get(`${API}/teachers/me/documents/${doc.body.id}/file`).set(other.auth)).status).toBe(404);
    expect((await ctx.http().get(`${API}/admin/teachers/${t.profile.id}/documents/${doc.body.id}/file`).set(student.auth)).status).toBe(403);
    const adminView = await ctx.http().get(`${API}/admin/teachers/${t.profile.id}/documents/${doc.body.id}/file`).set(admin.auth);
    expect(adminView.status).toBe(200);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.teacher_document_viewed', entityId: doc.body.id } })).toBe(1);

    // A teacher can never set their own approval state.
    expect((await ctx.http().patch(`${API}/teachers/me`).set(t.auth).send({ approvalStatus: 'APPROVED' })).status).toBe(400);
    expect((await ctx.http().post(`${API}/admin/teachers/${t.profile.id}/approval`).set(t.auth).send({ status: 'APPROVED' })).status).toBe(403);

    const submitted = await ctx.http().post(`${API}/teachers/me/application/submit`).set(t.auth);
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ underReview: true, canSubmit: false });
    expect((await upload(ctx, t.auth, PDF, 'more.pdf', 'application/pdf')).status).toBe(422); // locked while under review
    expect((await ctx.http().post(`${API}/teachers/me/application/submit`).set(t.auth)).status).toBe(422);

    const queue = await ctx.http().get(`${API}/admin/teachers`).query({ approvalStatus: 'PENDING', stage: 'submitted', q: t.user.email }).set(admin.auth);
    expect(queue.body.data.map((x: { id: string }) => x.id)).toEqual([t.profile.id]);

    expect((await ctx.http().post(`${API}/admin/teachers/${t.profile.id}/approval`).set(admin.auth).send({ status: 'REJECTED' })).status).toBe(400);
    const rejected = await ctx.http().post(`${API}/admin/teachers/${t.profile.id}/approval`).set(admin.auth).send({ status: 'REJECTED', note: 'Please upload your degree certificate' });
    expect(rejected.status).toBe(200);
    const app = await ctx.http().get(`${API}/teachers/me/application`).set(t.auth);
    expect(app.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Please upload your degree certificate', canSubmit: true });
    await deliverEmails(ctx, t.user.id);
    expect(ctx.email.sent.some((m) => m.to === t.user.email && m.text.includes('Please upload your degree certificate'))).toBe(true);

    expect((await upload(ctx, t.auth, PDF, 'certificate.pdf', 'application/pdf', { type: 'CERTIFICATE', title: 'Degree certificate' })).status).toBe(201);
    expect((await ctx.http().post(`${API}/teachers/me/application/submit`).set(t.auth)).status).toBe(200);
    const approved = await ctx.http().post(`${API}/admin/teachers/${t.profile.id}/approval`).set(admin.auth).send({ status: 'APPROVED' });
    expect(approved.status).toBe(200);
    const profile = await ctx.prisma.teacherProfile.findUniqueOrThrow({ where: { id: t.profile.id } });
    expect(profile).toMatchObject({ approvalStatus: 'APPROVED', rejectionReason: null, approvedById: admin.user.id });
    await deliverEmails(ctx, t.user.id, admin.user.id);
    expect(ctx.email.sent.some((m) => m.to === t.user.email && m.subject.includes('approved'))).toBe(true);
    expect(ctx.email.sent.some((m) => m.to === admin.user.email && m.subject.includes('New teacher application'))).toBe(true);
  });

  it('serves uploaded avatars publicly with safe headers and removes replaced ones', async () => {
    const t = await pendingTeacher(ctx);
    const a = await ctx.http().post(`${API}/teachers/me/avatar`).set(t.auth).attach('file', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(a.status).toBe(201);
    expect(a.body.avatarUrl).toMatch(/^\/api\/v1\/files\/avatars\/[0-9a-f-]{36}$/);
    const img = await ctx.http().get(a.body.avatarUrl);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    const b = await ctx.http().post(`${API}/teachers/me/avatar`).set(t.auth).attach('file', PNG, { filename: 'new.png', contentType: 'image/png' });
    expect((await ctx.http().get(a.body.avatarUrl)).status).toBe(404);
    expect((await ctx.http().get(b.body.avatarUrl)).status).toBe(200);
  });
});

describe('Earnings, completion and payouts', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, 'ADMIN');
    await ctx.http().put(`${API}/admin/settings/payouts.rules`).set(admin.auth).send({ value: { enabled: true, minPayoutMinor: 100, clearingDays: 0 } });
  });
  afterAll(async () => {
    // Back to defaults for other suites sharing the test database.
    await ctx.prisma.platformSetting.deleteMany({ where: { key: 'payouts.rules' } });
    await ctx.app.get(RedisService).client.del('settings:payouts.rules');
    await ctx.close();
  });

  /** A paid session moved into the past so it can be completed. */
  async function pastSession(teacher: Awaited<ReturnType<typeof createTeacher>>, daysAhead: number) {
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(daysAhead, 9));
    const start = new Date(Date.now() - (daysAhead * 24 + 3) * 3_600_000);
    const end = new Date(start.getTime() + 3_600_000);
    await ctx.prisma.booking.update({ where: { id: bookingId }, data: { startAt: start, endAt: end, blockedUntil: new Date(end.getTime() + 600_000) } });
    return { bookingId, student };
  }

  it('records exactly one earning when a teacher marks a finished session completed', async () => {
    const teacher = await createTeacher(ctx, { rateMinor: 100000 });
    const other = await createTeacher(ctx);
    const { bookingId, student } = await pastSession(teacher, 30);

    expect((await ctx.http().post(`${API}/bookings/${bookingId}/complete`).set(other.auth)).status).toBe(404);
    expect((await ctx.http().post(`${API}/bookings/${bookingId}/complete`).set(student.auth)).status).toBe(403);

    const results = await Promise.all([1, 2, 3].map(() => ctx.http().post(`${API}/bookings/${bookingId}/complete`).set(teacher.auth)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    await ctx.app.get(BookingsService).completeFinished();

    const earnings = await ctx.prisma.teacherEarning.findMany({ where: { bookingId } });
    expect(earnings).toHaveLength(1);
    expect(earnings[0].amountMinor).toBe(100000); // session price, not fee/tax

    const summary = await ctx.http().get(`${API}/teachers/me/earnings`).set(teacher.auth);
    expect(summary.body).toMatchObject({ lifetimeMinor: 100000, availableMinor: 100000, sessions: { completed: 1 } });
    expect((await ctx.http().get(`${API}/teachers/me/earnings`).set(other.auth)).body.lifetimeMinor).toBe(0);
    expect((await ctx.http().get(`${API}/teachers/me/earnings`).set(student.auth)).status).toBe(403);
  });

  it('refuses to complete sessions that have not ended', async () => {
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const { bookingId } = await bookAndPay(ctx, student, teacher, futureSlot(31, 10));
    const res = await ctx.http().post(`${API}/bookings/${bookingId}/complete`).set(teacher.auth);
    expect(res.status).toBe(422);
    expect(await ctx.prisma.teacherEarning.count({ where: { bookingId } })).toBe(0);
  });

  it('keeps the ledger append-only at the database level', async () => {
    const teacher = await createTeacher(ctx);
    const { bookingId } = await pastSession(teacher, 32);
    await ctx.http().post(`${API}/bookings/${bookingId}/complete`).set(teacher.auth);
    const e = await ctx.prisma.teacherEarning.findFirstOrThrow({ where: { bookingId } });
    await expect(ctx.prisma.teacherEarning.update({ where: { id: e.id }, data: { amountMinor: 999999 } })).rejects.toThrow(/append-only|immutable/);
    await expect(ctx.prisma.teacherEarning.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
  });

  it('allows one open payout per teacher and runs the manual payout lifecycle', async () => {
    const teacher = await createTeacher(ctx, { rateMinor: 60000 });
    const { bookingId } = await pastSession(teacher, 33);
    await ctx.http().post(`${API}/bookings/${bookingId}/complete`).set(teacher.auth);

    const reqs = await Promise.all([1, 2, 3, 4].map(() => ctx.http().post(`${API}/teachers/me/payouts`).set(teacher.auth).send({})));
    expect(reqs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(reqs.filter((r) => r.status === 409)).toHaveLength(3);
    const payout = reqs.find((r) => r.status === 201)!.body;
    expect(payout.amountMinor).toBe(60000);

    const otherTeacher = await createTeacher(ctx);
    expect((await ctx.http().post(`${API}/teachers/me/payouts/${payout.id}/cancel`).set(otherTeacher.auth)).status).toBe(404);
    expect((await ctx.http().post(`${API}/admin/payouts/${payout.id}/approve`).set(teacher.auth).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/admin/payouts/${payout.id}/paid`).set(admin.auth).send({ reference: 'UTR123456' })).status).toBe(422); // must approve first

    expect((await ctx.http().post(`${API}/admin/payouts/${payout.id}/approve`).set(admin.auth).send({})).status).toBe(200);
    const paid = await ctx.http().post(`${API}/admin/payouts/${payout.id}/paid`).set(admin.auth).send({ reference: 'UTR123456' });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'PAID', reference: 'UTR123456' });

    const summary = await ctx.http().get(`${API}/teachers/me/earnings`).set(teacher.auth);
    expect(summary.body).toMatchObject({ paidOutMinor: 60000, availableMinor: 0, inPayoutMinor: 0 });
    expect(await ctx.prisma.auditLog.count({ where: { entityType: 'TeacherPayout', entityId: payout.id } })).toBe(3);
    await deliverEmails(ctx, teacher.user.id);
    expect(ctx.email.sent.some((m) => m.to === teacher.user.email && m.text.includes('UTR123456'))).toBe(true);
  });

  it('returns earnings to the balance when a payout is rejected', async () => {
    const teacher = await createTeacher(ctx, { rateMinor: 50000 });
    const { bookingId } = await pastSession(teacher, 34);
    await ctx.http().post(`${API}/bookings/${bookingId}/complete`).set(teacher.auth);
    const p = await ctx.http().post(`${API}/teachers/me/payouts`).set(teacher.auth).send({});
    expect((await ctx.http().post(`${API}/admin/payouts/${p.body.id}/reject`).set(admin.auth).send({ reason: 'Bank details missing' })).status).toBe(200);
    const s = await ctx.http().get(`${API}/teachers/me/earnings`).set(teacher.auth);
    expect(s.body).toMatchObject({ availableMinor: 50000, inPayoutMinor: 0, paidOutMinor: 0 });
    expect((await ctx.http().post(`${API}/teachers/me/payouts`).set(teacher.auth).send({})).status).toBe(201);
  });

  it('gives students receipts for their own payments only, and admins a finance report', async () => {
    const teacher = await createTeacher(ctx, { rateMinor: 100000 });
    const student = await createUser(ctx, 'STUDENT');
    const intruder = await createUser(ctx, 'STUDENT');
    await bookAndPay(ctx, student, teacher, futureSlot(35, 9));
    const list = await ctx.http().get(`${API}/students/me/payments`).set(student.auth);
    expect(list.status).toBe(200);
    const pay = list.body.data[0];
    const receipt = await ctx.http().get(`${API}/students/me/payments/${pay.id}/receipt`).set(student.auth);
    expect(receipt.status).toBe(200);
    expect(receipt.body.lines.reduce((s: number, l: { amountMinor: number }) => s + l.amountMinor, 0)).toBe(receipt.body.totalMinor);
    expect((await ctx.http().get(`${API}/students/me/payments/${pay.id}/receipt`).set(intruder.auth)).status).toBe(404);

    const summary = await ctx.http().get(`${API}/admin/finance/summary`).set(admin.auth);
    expect(summary.status).toBe(200);
    expect(summary.body.collectedMinor).toBeGreaterThanOrEqual(receipt.body.totalMinor);
    const csv = await ctx.http().get(`${API}/admin/finance/report.csv`).set(admin.auth);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(receipt.body.session.bookingId);
    expect((await ctx.http().get(`${API}/admin/finance/summary`).set(student.auth)).status).toBe(403);
  });
});

describe('Admin account removal and announcements', () => {
  let ctx: TestContext;
  beforeAll(async () => (ctx = await createTestApp()));
  afterAll(() => ctx.close());

  it('requires typing the email to remove an account and erases personal data', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const t = await pendingTeacher(ctx);
    await upload(ctx, t.auth, PDF, 'degree.pdf', 'application/pdf');
    expect((await ctx.http().post(`${API}/admin/users/${t.user.id}/remove`).set(admin.auth).send({ confirmEmail: 'wrong@x.y', reason: 'Policy breach' })).status).toBe(400);
    expect((await ctx.http().post(`${API}/admin/users/${admin.user.id}/remove`).set(admin.auth).send({ confirmEmail: admin.user.email, reason: 'Testing self' })).status).toBe(403);
    const ok = await ctx.http().post(`${API}/admin/users/${t.user.id}/remove`).set(admin.auth).send({ confirmEmail: t.user.email, reason: 'Policy breach' });
    expect(ok.status).toBe(200);
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: t.user.id } });
    expect(u.status).toBe('DELETED');
    expect(u.email).not.toBe(t.user.email);
    expect(await ctx.prisma.storedFile.count({ where: { ownerId: t.user.id } })).toBe(0);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'admin.user_removed', entityId: t.user.id } })).toBe(1);
  });

  it('shows announcements only to their audience', async () => {
    const admin = await createUser(ctx, 'ADMIN');
    const teacher = await createTeacher(ctx);
    const student = await createUser(ctx, 'STUDENT');
    const title = `Teachers only ${randomUUID().slice(0, 6)}`;
    const a = await ctx.http().post(`${API}/admin/announcements`).set(admin.auth).send({ title, body: 'New payout schedule', audience: 'TEACHER' });
    expect(a.status).toBe(201);
    const forTeacher = await ctx.http().get(`${API}/announcements`).set(teacher.auth);
    const forStudent = await ctx.http().get(`${API}/announcements`).set(student.auth);
    expect(forTeacher.body.some((x: { title: string }) => x.title === title)).toBe(true);
    expect(forStudent.body.some((x: { title: string }) => x.title === title)).toBe(false);
    expect((await ctx.http().post(`${API}/admin/announcements`).set(teacher.auth).send({ title, body: 'x', audience: 'ALL' })).status).toBe(403);
    await ctx.http().post(`${API}/admin/announcements/${a.body.id}/archive`).set(admin.auth);
    expect((await ctx.http().get(`${API}/announcements`).set(teacher.auth)).body.some((x: { title: string }) => x.title === title)).toBe(false);
  });
});
