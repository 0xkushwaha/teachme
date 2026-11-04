import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { CreateAdminError, createOrPromoteAdmin } from '../../src/cli/create-admin';
import { PasswordService } from '../../src/modules/auth/password.service';

describe('create-admin CLI (first admin bootstrap)', () => {
  const prisma = new PrismaClient();
  const passwords = new PasswordService();
  const email = () => `admin-cli-${randomUUID().slice(0, 8)}@test.local`;
  afterAll(() => prisma.$disconnect());

  it('creates a verified, active ADMIN whose password works with the app hashing parameters', async () => {
    const addr = email();
    const res = await createOrPromoteAdmin(prisma, { email: `  ${addr.toUpperCase()} `, fullName: ' Jane Owner ', password: 'Str0ngAdminPass' });
    expect(res.outcome).toBe('created');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: addr } });
    expect(user).toMatchObject({ role: 'ADMIN', status: 'ACTIVE', fullName: 'Jane Owner' });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await passwords.verify(user.passwordHash, 'Str0ngAdminPass')).toBe(true);
    expect(passwords.needsRehash(user.passwordHash)).toBe(false);
    const logs = await prisma.auditLog.findMany({ where: { entityType: 'User', entityId: user.id } });
    expect(logs.map((l) => l.action)).toEqual(['admin.bootstrap_created']);
  });

  it('is idempotent: re-running for an existing admin changes nothing', async () => {
    const addr = email();
    await createOrPromoteAdmin(prisma, { email: addr, fullName: 'Jane Owner', password: 'Str0ngAdminPass' });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: addr } });
    const res = await createOrPromoteAdmin(prisma, { email: addr, fullName: 'Someone Else' });
    expect(res.outcome).toBe('already-admin');
    const after = await prisma.user.findUniqueOrThrow({ where: { email: addr } });
    expect(after).toEqual(before);
    expect(await prisma.auditLog.count({ where: { entityId: before.id } })).toBe(1);
  });

  it('promotes an existing account without touching its password', async () => {
    const addr = email();
    const passwordHash = await passwords.hash('Student12345');
    const student = await prisma.user.create({ data: { email: addr, passwordHash, fullName: 'Existing Student', role: 'STUDENT', studentProfile: { create: {} } } });
    const res = await createOrPromoteAdmin(prisma, { email: addr });
    expect(res).toMatchObject({ outcome: 'promoted', previousRole: 'STUDENT', userId: student.id });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: student.id } });
    expect(user.role).toBe('ADMIN');
    expect(user.passwordHash).toBe(passwordHash);
    expect(user.emailVerifiedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: student.id, action: 'admin.bootstrap_promoted' } });
    expect(log.metadata).toMatchObject({ previousRole: 'STUDENT', passwordReset: false });
  });

  it('resets an existing admin password on request and revokes their sessions', async () => {
    const addr = email();
    const { userId } = await createOrPromoteAdmin(prisma, { email: addr, fullName: 'Jane Owner', password: 'Str0ngAdminPass' });
    await prisma.session.create({ data: { userId, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86_400_000) } });
    const res = await createOrPromoteAdmin(prisma, { email: addr, password: 'An0therStrongOne', resetPassword: true });
    expect(res.outcome).toBe('password-reset');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await passwords.verify(user.passwordHash, 'An0therStrongOne')).toBe(true);
    expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it.each(['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsInThisOne'])('rejects weak password %s and creates nothing', async (pw) => {
    const addr = email();
    await expect(createOrPromoteAdmin(prisma, { email: addr, fullName: 'Jane Owner', password: pw })).rejects.toThrow(CreateAdminError);
    expect(await prisma.user.findUnique({ where: { email: addr } })).toBeNull();
  });

  it('requires a password and name to create, and refuses inactive accounts', async () => {
    await expect(createOrPromoteAdmin(prisma, { email: email(), fullName: 'Jane Owner' })).rejects.toThrow(/Password must be/);
    await expect(createOrPromoteAdmin(prisma, { email: email(), password: 'Str0ngAdminPass' })).rejects.toThrow(/--name/);
    await expect(createOrPromoteAdmin(prisma, { email: 'not-an-email', fullName: 'Jane Owner', password: 'Str0ngAdminPass' })).rejects.toThrow(/valid email/);
    const addr = email();
    await prisma.user.create({ data: { email: addr, passwordHash: 'x', fullName: 'Suspended User', status: 'SUSPENDED' } });
    await expect(createOrPromoteAdmin(prisma, { email: addr })).rejects.toThrow(/SUSPENDED/);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: addr } })).role).toBe('STUDENT');
  });
});
