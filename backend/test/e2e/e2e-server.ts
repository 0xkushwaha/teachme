/**
 * TEST-ONLY end-to-end backend. Never part of the production build (lives in test/).
 *  - Real API, real workers, real Postgres/Redis, real SMTP (to Mailpit).
 *  - Razorpay HTTP calls and Google Calendar are replaced by in-memory fakes; Razorpay signature
 *    verification remains the real HMAC implementation.
 *  - Exposes /api/v1/__test__/* control endpoints used by Playwright.
 */
import { E2E_ENV } from './e2e-env';
Object.assign(process.env, E2E_ENV);

import 'reflect-metadata';
import { execSync } from 'child_process';
import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app';
import { AppConfig } from '../../src/config/app-config';
import { Public, SkipCsrf } from '../../src/common/decorators';
import { PAYMENT_GATEWAY } from '../../src/integrations/razorpay/payment-gateway';
import { CALENDAR_GATEWAY } from '../../src/integrations/google/calendar-gateway';
import { JobQueueService } from '../../src/jobs/job-queue.service';
import { QUEUES } from '../../src/jobs/queues';
import { TokenService } from '../../src/modules/auth/token.service';
import { encrypt } from '../../src/utils/crypto';
import { FakeCalendarGateway, FakePaymentGateway } from '../helpers/fakes';

const payments = new FakePaymentGateway(new AppConfig());
const calendar = new FakeCalendarGateway();
calendar.meetOnInsert = 'pending'; // exercise the async conference path

export const E2E_TEACHER = { email: 'e2e.teacher@teachme.test', slug: 'e2e-teacher', password: 'E2e-Teacher-Pass1' };

@Public()
@SkipCsrf()
@Controller('__test__')
class TestControlController {
  constructor(
    private readonly tokens: TokenService,
    private readonly jobs: JobQueueService,
  ) {}

  /** Plays the role of the customer completing Razorpay Checkout. */
  @Post('razorpay/pay')
  pay(@Body() body: { orderId: string; status?: 'captured' | 'failed' }) {
    const r = payments.pay(body.orderId, { status: body.status ?? 'captured' });
    return { razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature };
  }

  /** Creates a verified student and returns a Bearer token (for API-level steps). */
  @Post('students')
  async student() {
    const prisma = new PrismaClient();
    const user = await prisma.user.create({
      data: {
        email: `api-student-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@teachme.test`,
        passwordHash: await argon2.hash(randomUUID()),
        fullName: 'Rival Student',
        emailVerifiedAt: new Date(),
        studentProfile: { create: {} },
      },
    });
    await prisma.$disconnect();
    return { id: user.id, token: this.tokens.signAccess({ sub: user.id, role: 'STUDENT', sid: randomUUID() }) };
  }

  @Get('reminders/:bookingId')
  async reminders(@Param('bookingId') bookingId: string) {
    const delayed = await this.jobs.queue(QUEUES.reminders).getDelayed(0, 1000);
    return delayed.filter((j) => j.data.bookingId === bookingId).map((j) => ({ offsetMinutes: j.data.offsetMinutes, fireAt: new Date(j.timestamp + (j.opts.delay ?? 0)).toISOString() }));
  }

  @Get('calendar/:bookingId')
  calendarEvent(@Param('bookingId') bookingId: string) {
    const e = calendar.events.get(`tm${bookingId.replace(/-/g, '')}`);
    return e ? { exists: true, startIso: e.startIso, cancelled: !!e.cancelled, meetStatus: e.meetStatus } : { exists: false };
  }
}

@Module({ controllers: [TestControlController] })
class TestControlModule {}

async function prepareDatabase() {
  const url = new URL(E2E_ENV.DATABASE_URL);
  const db = url.pathname.slice(1);
  if (!db.endsWith('_e2e')) throw new Error(`Refusing to use non-e2e database ${db}`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  const exists = await client.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${db}`;
  if (!exists.length) await client.$executeRawUnsafe(`CREATE DATABASE "${db}"`);
  await client.$disconnect();
  execSync('npx prisma migrate deploy', { env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, stdio: 'pipe' });
  // Base catalogue + demo teachers come from the regular development seed.
  execSync('npx ts-node --transpile-only prisma/seed.ts', { env: { ...process.env, NODE_ENV: 'development' }, stdio: 'pipe' });
}

/** A teacher who is bookable at any hour, with Google connected (fake), so tests never depend on the clock. */
async function upsertE2ETeacher() {
  const prisma = new PrismaClient();
  const subject = await prisma.subject.findUniqueOrThrow({ where: { slug: 'physics' } });
  const passwordHash = await argon2.hash(E2E_TEACHER.password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { email: E2E_TEACHER.email },
    create: { email: E2E_TEACHER.email, passwordHash, fullName: 'Ishaan Rao', role: 'TEACHER', timezone: 'Asia/Kolkata', emailVerifiedAt: new Date(), privacyConsentAt: new Date() },
    update: { passwordHash, status: 'ACTIVE' },
  });
  const profile = await prisma.teacherProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id, slug: E2E_TEACHER.slug, headline: 'Physics teacher for end-to-end tests', bio: 'Teaches mechanics and electromagnetism; available around the clock for automated end-to-end testing.',
      languages: ['English'], timezone: 'Asia/Kolkata', approvalStatus: 'APPROVED', approvedAt: new Date(), sessionDurations: [60], bufferMinutes: 0, minNoticeMinutes: 60, maxAdvanceDays: 30, yearsExperience: 5,
    },
    update: { approvalStatus: 'APPROVED' },
  });
  await prisma.teacherSubject.upsert({
    where: { teacherId_subjectId: { teacherId: profile.id, subjectId: subject.id } },
    create: { teacherId: profile.id, subjectId: subject.id, hourlyRateMinor: 120000 },
    update: { hourlyRateMinor: 120000, isActive: true },
  });
  await prisma.teacherAvailability.deleteMany({ where: { teacherId: profile.id } });
  await prisma.teacherAvailability.createMany({ data: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ teacherId: profile.id, dayOfWeek: d, startMinute: 0, endMinute: 1440 })) });
  await prisma.calendarConnection.upsert({
    where: { userId_provider: { userId: user.id, provider: 'GOOGLE' } },
    create: { userId: user.id, encryptedRefreshToken: encrypt('1//e2e-refresh', E2E_ENV.DATA_ENCRYPTION_KEY), scopes: ['https://www.googleapis.com/auth/calendar.events'], accountEmail: 'ishaan@gmail.test' },
    update: { status: 'ACTIVE', encryptedRefreshToken: encrypt('1//e2e-refresh', E2E_ENV.DATA_ENCRYPTION_KEY) },
  });
  await prisma.$disconnect();
}

async function main() {
  await prepareDatabase();
  await upsertE2ETeacher();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register({ workers: true, extraImports: [{ module: TestControlModule }] })] })
    .overrideProvider(PAYMENT_GATEWAY)
    .useValue(payments)
    .overrideProvider(CALENDAR_GATEWAY)
    .useValue(calendar)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(Number(E2E_ENV.PORT));
  console.log(`E2E backend ready on ${E2E_ENV.API_URL}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
