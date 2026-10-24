import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '../../src/common/guards/auth.guard';
import { CsrfGuard } from '../../src/common/guards/csrf.guard';
import { BookingsService } from '../../src/modules/bookings/bookings.service';
import { ROLES, IS_PUBLIC, SKIP_CSRF, REQUIRE_VERIFIED } from '../../src/common/decorators';
import type { AuthUser } from '../../src/common/auth-user';
import type { AppConfig } from '../../src/config/app-config';

function ctx(req: Record<string, unknown>, meta: Record<string, unknown> = {}): [ExecutionContext, Reflector] {
  const handler = () => undefined;
  const reflector = { getAllAndOverride: (key: string) => meta[key], get: (key: string) => meta[key] } as unknown as Reflector;
  const ec = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => handler, getClass: () => Object } as unknown as ExecutionContext;
  return [ec, reflector];
}

describe('AuthGuard', () => {
  const user = { id: 'u1', email: 'a@b.c', role: 'STUDENT', status: 'ACTIVE', emailVerifiedAt: new Date(), teacherProfile: null };
  const tokens = { verifyAccess: (t: string) => (t === 'good' ? { sub: 'u1', role: 'STUDENT', sid: 's' } : null) };
  const prisma = (u: unknown) => ({ user: { findUnique: async () => u } });

  it('rejects unauthenticated access to protected routes', async () => {
    const [ec, r] = ctx({ headers: {}, cookies: {} });
    await expect(new AuthGuard(r, tokens as never, prisma(user) as never).canActivate(ec)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('allows public routes without a token', async () => {
    const [ec, r] = ctx({ headers: {}, cookies: {} }, { [IS_PUBLIC]: true });
    await expect(new AuthGuard(r, tokens as never, prisma(user) as never).canActivate(ec)).resolves.toBe(true);
  });
  it('enforces roles server-side', async () => {
    const [ec, r] = ctx({ headers: { authorization: 'Bearer good' }, cookies: {} }, { [ROLES]: ['ADMIN'] });
    await expect(new AuthGuard(r, tokens as never, prisma(user) as never).canActivate(ec)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('treats suspended users as unauthenticated even with a valid token', async () => {
    const [ec, r] = ctx({ headers: { authorization: 'Bearer good' }, cookies: {} });
    await expect(new AuthGuard(r, tokens as never, prisma({ ...user, status: 'SUSPENDED' }) as never).canActivate(ec)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('requires a verified email where declared', async () => {
    const [ec, r] = ctx({ headers: { authorization: 'Bearer good' }, cookies: {} }, { [REQUIRE_VERIFIED]: true });
    await expect(new AuthGuard(r, tokens as never, prisma({ ...user, emailVerifiedAt: null }) as never).canActivate(ec)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });
});

describe('CsrfGuard', () => {
  const config = { corsOrigins: ['http://localhost:3000'], env: { APP_URL: 'http://localhost:3000', API_URL: 'http://localhost:4000' } } as unknown as AppConfig;
  it('requires matching header and cookie for cookie-authenticated writes', () => {
    const [ec, r] = ctx({ method: 'POST', headers: {}, cookies: { tm_csrf: 'tok' }, authVia: 'cookie' });
    expect(() => new CsrfGuard(r, config).canActivate(ec)).toThrow();
    const [ok, r2] = ctx({ method: 'POST', headers: { 'x-csrf-token': 'tok' }, cookies: { tm_csrf: 'tok' }, authVia: 'cookie' });
    expect(new CsrfGuard(r2, config).canActivate(ok)).toBe(true);
  });
  it('blocks foreign origins', () => {
    const [ec, r] = ctx({ method: 'POST', headers: { origin: 'https://evil.example', 'x-csrf-token': 'tok' }, cookies: { tm_csrf: 'tok' } });
    expect(() => new CsrfGuard(r, config).canActivate(ec)).toThrow();
  });
  it('exempts safe methods, bearer clients and signed webhooks', () => {
    expect(new CsrfGuard(...rev(ctx({ method: 'GET', headers: {}, cookies: {} })), config).canActivate(ctx({ method: 'GET', headers: {}, cookies: {} })[0])).toBe(true);
    const [b, rb] = ctx({ method: 'POST', headers: {}, cookies: {}, authVia: 'bearer' });
    expect(new CsrfGuard(rb, config).canActivate(b)).toBe(true);
    const [w, rw] = ctx({ method: 'POST', headers: {}, cookies: {} }, { [SKIP_CSRF]: true });
    expect(new CsrfGuard(rw, config).canActivate(w)).toBe(true);
  });
});

function rev([ec, r]: [ExecutionContext, Reflector]): [Reflector] {
  void ec;
  return [r];
}

describe('booking object-level authorization', () => {
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const booking = { studentId: 'student-1', teacherId: 'teacher-profile-1' };
  const u = (o: Partial<AuthUser>): AuthUser => ({ id: 'x', email: 'x', role: 'STUDENT', teacherProfileId: null, emailVerified: true, ...o });

  it('allows the owning student, owning teacher and admins', () => {
    expect(svc.canAccess(u({ id: 'student-1' }), booking)).toBe(true);
    expect(svc.canAccess(u({ role: 'TEACHER', teacherProfileId: 'teacher-profile-1' }), booking)).toBe(true);
    expect(svc.canAccess(u({ role: 'ADMIN' }), booking)).toBe(true);
  });
  it('denies other students and other teachers', () => {
    expect(svc.canAccess(u({ id: 'student-2' }), booking)).toBe(false);
    expect(svc.canAccess(u({ role: 'TEACHER', teacherProfileId: 'teacher-profile-2' }), booking)).toBe(false);
  });
});
