import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DateTime } from 'luxon';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app';
import { AppConfig } from '../../src/config/app-config';
import { PrismaService } from '../../src/database/prisma.service';
import { PAYMENT_GATEWAY } from '../../src/integrations/razorpay/payment-gateway';
import { CALENDAR_GATEWAY } from '../../src/integrations/google/calendar-gateway';
import { EMAIL_PROVIDER } from '../../src/integrations/email/email-provider';
import { OutboxDispatcher } from '../../src/jobs/outbox.dispatcher';
import { TokenService } from '../../src/modules/auth/token.service';
import { PasswordService } from '../../src/modules/auth/password.service';
import { FakeCalendarGateway, FakeEmailProvider, FakePaymentGateway } from './fakes';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  payments: FakePaymentGateway;
  calendar: FakeCalendarGateway;
  email: FakeEmailProvider;
  outbox: OutboxDispatcher;
  http: () => request.Agent;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const config = new AppConfig();
  const payments = new FakePaymentGateway(config);
  const calendar = new FakeCalendarGateway();
  const email = new FakeEmailProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ workers: false })], providers: [OutboxDispatcher] })
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(payments)
    .overrideProvider(CALENDAR_GATEWAY)
    .useValue(calendar)
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(email)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    payments,
    calendar,
    email,
    outbox: app.get(OutboxDispatcher),
    http: () => request.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(++n).toString(36)}`;

export async function createUser(ctx: TestContext, role: 'STUDENT' | 'TEACHER' | 'ADMIN', opts: { verified?: boolean } = {}) {
  const passwordHash = await ctx.app.get(PasswordService).hash('Password12345');
  const user = await ctx.prisma.user.create({
    data: {
      email: `${role.toLowerCase()}-${uniq()}@test.local`,
      passwordHash,
      fullName: `${role[0]}${role.slice(1).toLowerCase()} ${uniq()}`,
      role,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      ...(role === 'STUDENT' ? { studentProfile: { create: {} } } : {}),
    },
  });
  const token = ctx.app.get(TokenService).signAccess({ sub: user.id, role, sid: randomUUID() });
  return { user, token, auth: { Authorization: `Bearer ${token}` } };
}

/** Approved teacher, available every day 00:00-24:00 in UTC, no notice, 10 min buffer. */
export async function createTeacher(ctx: TestContext, opts: { buffer?: number; rateMinor?: number } = {}) {
  const t = await createUser(ctx, 'TEACHER');
  const category = await ctx.prisma.subjectCategory.upsert({ where: { slug: 'test-cat' }, create: { slug: 'test-cat', name: 'Test' }, update: {} });
  const subject = await ctx.prisma.subject.upsert({
    where: { slug: 'test-physics' },
    create: { slug: 'test-physics', name: 'Physics', description: 'Test subject', categoryId: category.id },
    update: {},
  });
  const profile = await ctx.prisma.teacherProfile.create({
    data: {
      userId: t.user.id,
      slug: `t-${uniq()}`,
      headline: 'Experienced physics teacher for tests',
      bio: 'A long enough biography for the teacher profile used in integration tests, exceeding fifty characters.',
      languages: ['English'],
      timezone: 'UTC',
      approvalStatus: 'APPROVED',
      sessionDurations: [30, 60],
      bufferMinutes: opts.buffer ?? 10,
      minNoticeMinutes: 0,
      maxAdvanceDays: 90,
      subjects: { create: { subjectId: subject.id, hourlyRateMinor: opts.rateMinor ?? 100000 } },
      availability: { create: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dayOfWeek: d, startMinute: 0, endMinute: 1440 })) },
    },
  });
  const token = ctx.app.get(TokenService).signAccess({ sub: t.user.id, role: 'TEACHER', sid: randomUUID() });
  return { ...t, token, auth: { Authorization: `Bearer ${token}` }, profile, subject };
}

/** A slot start N days ahead at the given UTC hour (aligned to the 30-min grid). */
export function futureSlot(daysAhead: number, hourUtc: number, minute = 0) {
  return DateTime.utc().plus({ days: daysAhead }).set({ hour: hourUtc, minute, second: 0, millisecond: 0 }).toISO()!;
}

export function idem() {
  return `test-${uniq()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reserve → order → pay → verify. Returns the confirmed booking id. */
export async function bookAndPay(ctx: TestContext, student: { auth: Record<string, string> }, teacher: Awaited<ReturnType<typeof createTeacher>>, startAt: string, durationMinutes = 60) {
  const res = await ctx.http().post('/api/v1/bookings').set(student.auth).set('Idempotency-Key', idem()).send({ teacherId: teacher.profile.id, subjectId: teacher.subject.id, startAt, durationMinutes });
  if (res.status !== 201) throw new Error(`reserve failed ${res.status} ${JSON.stringify(res.body)}`);
  const order = await ctx.http().post('/api/v1/payments/orders').set(student.auth).set('Idempotency-Key', idem()).send({ bookingId: res.body.id });
  const paid = ctx.payments.pay(order.body.orderId);
  const v = await ctx.http().post('/api/v1/payments/razorpay/verify').set(student.auth).send({ bookingId: res.body.id, ...paid, payment: undefined });
  if (v.body.outcome !== 'confirmed') throw new Error(`verify failed ${JSON.stringify(v.body)}`);
  return { bookingId: res.body.id as string, orderId: order.body.orderId as string, paymentId: paid.razorpay_payment_id };
}

/** Drains the outbox completely (the shared test DB may hold events from other suites). */
export async function drainOutbox(ctx: TestContext) {
  for (let i = 0; i < 200; i++) {
    if ((await ctx.outbox.drain()) === 0) return;
  }
}
