/**
 * Load-test data set (DEVELOPMENT/STAGING ONLY). Idempotent.
 *  - 3,000 verified students, ~150 approved teachers with weekly hours
 *  - ~15,000 completed historical bookings so dashboards/analytics query realistic volumes
 *  - Writes loadtest-results/tokens.json: 1-hour Bearer tokens for students (for k6), signed
 *    with this environment's JWT secret. Never run against production.
 */
import '../src/config/load-dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const STUDENTS = Number(process.env.LT_STUDENTS ?? 3000);
const TEACHERS = Number(process.env.LT_TEACHERS ?? 150);
const PAST_PER_TEACHER = Number(process.env.LT_PAST ?? 100);
const PASSWORD = process.env.LT_PASSWORD ?? 'Load-Test-Pass-2026';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.LT_ALLOW !== 'yes') throw new Error('Refusing to seed load-test data in production');
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const subjects = await prisma.subject.findMany({ where: { isActive: true } });
  if (!subjects.length) throw new Error('Run the base seed first (npm run db:seed)');

  // Students
  const existing = await prisma.user.count({ where: { email: { startsWith: 'lt-student-' } } });
  for (let i = existing; i < STUDENTS; i += 500) {
    const batch = Array.from({ length: Math.min(500, STUDENTS - i) }, (_, k) => ({
      id: randomUUID(),
      email: `lt-student-${i + k}@load.test`,
      passwordHash: hash,
      fullName: `Load Student ${i + k}`,
      emailVerifiedAt: new Date(),
      privacyConsentAt: new Date(),
    }));
    await prisma.user.createMany({ data: batch, skipDuplicates: true });
    await prisma.studentProfile.createMany({ data: batch.map((u) => ({ userId: u.id })), skipDuplicates: true });
  }

  // Teachers
  const tExisting = await prisma.user.count({ where: { email: { startsWith: 'lt-teacher-' } } });
  for (let i = tExisting; i < TEACHERS; i++) {
    const subject = subjects[i % subjects.length];
    await prisma.user.create({
      data: {
        email: `lt-teacher-${i}@load.test`,
        passwordHash: hash,
        fullName: `Load Teacher ${i}`,
        role: 'TEACHER',
        emailVerifiedAt: new Date(),
        teacherProfile: {
          create: {
            slug: `lt-teacher-${i}`,
            headline: `${subject.name} tutor (load-test profile)`,
            bio: 'Synthetic profile used only for load testing. Teaches structured lessons with practice problems.',
            languages: i % 3 ? ['English', 'Hindi'] : ['English'],
            yearsExperience: 1 + (i % 15),
            approvalStatus: 'APPROVED',
            approvedAt: new Date(),
            sessionDurations: [30, 60],
            bufferMinutes: 10,
            minNoticeMinutes: 60,
            subjects: { create: { subjectId: subject.id, hourlyRateMinor: 50000 + (i % 20) * 5000 } },
            availability: { create: [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, startMinute: 8 * 60, endMinute: 20 * 60 })) },
          },
        },
      },
    });
  }

  // Historical bookings (completed): sequential, non-overlapping per teacher.
  const studentIds = (await prisma.user.findMany({ where: { email: { startsWith: 'lt-student-' } }, select: { id: true }, orderBy: { email: 'asc' } })).map((u) => u.id);
  const teachers = await prisma.teacherProfile.findMany({ where: { slug: { startsWith: 'lt-teacher-' } }, include: { subjects: true } });
  const have = await prisma.booking.count({ where: { teacher: { slug: { startsWith: 'lt-teacher-' } } } });
  if (have < teachers.length * PAST_PER_TEACHER * 0.9) {
    let s = 0;
    for (const t of teachers) {
      const rows: Prisma.BookingCreateManyInput[] = [];
      for (let n = 0; n < PAST_PER_TEACHER; n++) {
        const start = new Date(Date.now() - (n + 2) * 26 * 3_600_000);
        start.setUTCMinutes(0, 0, 0);
        const end = new Date(start.getTime() + 3_600_000);
        const price = t.subjects[0].hourlyRateMinor;
        const fee = Math.round(price * 0.05);
        const tax = Math.round(fee * 0.18);
        rows.push({
          studentId: studentIds[s++ % studentIds.length],
          teacherId: t.id,
          subjectId: t.subjects[0].subjectId,
          startAt: start,
          endAt: end,
          blockedUntil: new Date(end.getTime() + 600_000),
          durationMinutes: 60,
          studentTimezone: 'Asia/Kolkata',
          teacherTimezone: 'Asia/Kolkata',
          status: 'COMPLETED',
          priceMinor: price,
          platformFeeMinor: fee,
          taxMinor: tax,
          totalMinor: price + fee + tax,
          policySnapshot: {},
          confirmedAt: new Date(start.getTime() - 86_400_000),
          completedAt: end,
          createdAt: new Date(start.getTime() - 86_400_000),
        });
      }
      await prisma.booking.createMany({ data: rows, skipDuplicates: true }).catch(() => undefined);
    }
  }

  // Tokens for k6 (1 hour)
  const secret = process.env.JWT_ACCESS_SECRET!;
  const students = await prisma.user.findMany({ where: { email: { startsWith: 'lt-student-' } }, select: { id: true }, take: STUDENTS });
  const tokens = students.map((u) => jwt.sign({ sub: u.id, role: 'STUDENT', sid: randomUUID() }, secret, { algorithm: 'HS256', expiresIn: 3600, issuer: 'teachme-api', audience: 'teachme-web' }));
  const out = join(__dirname, '..', '..', 'loadtest-results');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'tokens.json'), JSON.stringify(tokens));
  const counts = {
    users: await prisma.user.count(),
    teachers: await prisma.teacherProfile.count({ where: { approvalStatus: 'APPROVED' } }),
    bookings: await prisma.booking.count(),
  };
  console.log('Load-test data ready', counts, `tokens: ${tokens.length}`);
}

main().finally(() => prisma.$disconnect());
