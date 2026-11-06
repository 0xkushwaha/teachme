import { randomUUID } from 'crypto';
import { createTeacher, createTestApp, createUser, TestContext } from '../helpers/test-app';

describe('Admin delete actions', () => {
  let ctx: TestContext;
  let admin: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await createUser(ctx, 'ADMIN');
  });
  afterAll(() => ctx.close());

  const del = (path: string) => ctx.http().delete(`/api/v1/admin/${path}`).set(admin.auth);
  const newCategory = () => ctx.prisma.subjectCategory.create({ data: { name: 'Delete test', slug: `delete-test-${randomUUID()}` } });
  const newSubject = (categoryId: string) =>
    ctx.prisma.subject.create({ data: { name: 'Delete test', slug: `delete-test-${randomUUID()}`, description: 'x', categoryId } });
  const auditCount = (action: string, entityId: string) => ctx.prisma.auditLog.count({ where: { action, entityId } });

  it('rejects non-admins on every delete route', async () => {
    const student = await createUser(ctx, 'STUDENT');
    const id = randomUUID();
    for (const path of [`subjects/${id}`, `categories/${id}`, `support-tickets/${id}`, `announcements/${id}`, `invitations/${id}`]) {
      expect((await ctx.http().delete(`/api/v1/admin/${path}`)).status).toBe(401);
      expect((await ctx.http().delete(`/api/v1/admin/${path}`).set(student.auth)).status).toBe(403);
      expect((await del(path)).status).toBe(404);
    }
  });

  it('deletes an unused subject and an empty category, recording both', async () => {
    const category = await newCategory();
    const subject = await newSubject(category.id);
    const blocked = await del(`categories/${category.id}`);
    expect(blocked.status).toBe(409);
    expect((await del(`subjects/${subject.id}`)).status).toBe(204);
    expect((await del(`categories/${category.id}`)).status).toBe(204);
    expect(await ctx.prisma.subject.count({ where: { id: subject.id } })).toBe(0);
    expect(await ctx.prisma.subjectCategory.count({ where: { id: category.id } })).toBe(0);
    expect(await auditCount('admin.subject_deleted', subject.id)).toBe(1);
    expect(await auditCount('admin.category_deleted', category.id)).toBe(1);
  });

  it('refuses to delete a subject a topper offers', async () => {
    const category = await newCategory();
    const subject = await newSubject(category.id);
    const topper = await createTeacher(ctx);
    await ctx.prisma.teacherSubject.create({ data: { teacherId: topper.profile.id, subjectId: subject.id, hourlyRateMinor: 100_000 } });
    expect((await del(`subjects/${subject.id}`)).status).toBe(409);
    expect(await ctx.prisma.subject.count({ where: { id: subject.id } })).toBe(1);
  });

  it('deletes announcements, including archived ones', async () => {
    const live = await ctx.prisma.announcement.create({ data: { title: 'Live', body: 'Body' } });
    const archived = await ctx.prisma.announcement.create({ data: { title: 'Old', body: 'Body', archivedAt: new Date() } });
    expect((await del(`announcements/${live.id}`)).status).toBe(204);
    expect((await del(`announcements/${archived.id}`)).status).toBe(204);
    expect(await ctx.prisma.announcement.count({ where: { id: { in: [live.id, archived.id] } } })).toBe(0);
    expect(await auditCount('admin.announcement_deleted', live.id)).toBe(1);
  });

  it('deletes support tickets', async () => {
    const t = await ctx.prisma.supportTicket.create({ data: { name: 'A', email: 'a@example.com', category: 'OTHER', subject: 'S', message: 'M' } });
    expect((await del(`support-tickets/${t.id}`)).status).toBe(204);
    expect(await ctx.prisma.supportTicket.count({ where: { id: t.id } })).toBe(0);
    expect(await auditCount('admin.ticket_deleted', t.id)).toBe(1);
  });

  it('only deletes revoked or expired invitations', async () => {
    const make = (status: 'PENDING' | 'ACCEPTED' | 'REVOKED', expiresAt: Date) =>
      ctx.prisma.teacherInvitation.create({ data: { email: `${randomUUID()}@example.com`, tokenHash: randomUUID(), status, expiresAt } });
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    const pending = await make('PENDING', future);
    const accepted = await make('ACCEPTED', future);
    const revoked = await make('REVOKED', future);
    const expired = await make('PENDING', past);
    expect((await del(`invitations/${pending.id}`)).status).toBe(422);
    expect((await del(`invitations/${accepted.id}`)).status).toBe(422);
    expect((await del(`invitations/${revoked.id}`)).status).toBe(204);
    expect((await del(`invitations/${expired.id}`)).status).toBe(204);
    expect(await ctx.prisma.teacherInvitation.count({ where: { id: { in: [pending.id, accepted.id] } } })).toBe(2);
  });
});
