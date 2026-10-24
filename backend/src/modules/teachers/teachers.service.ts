import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppError, ErrorCode } from '../../common/errors';
import { SettingsService } from '../../services/settings.service';
import { calculatePrice } from '../../utils/money';
import { SubjectsService } from '../subjects/subjects.service';
import { ReplaceTeacherSubjectsDto, SearchTeachersQuery, UpdateTeacherProfileDto } from './dto/teachers.dto';

const PUBLIC_INCLUDE = {
  user: { select: { fullName: true } },
  subjects: {
    where: { isActive: true, subject: { isActive: true } },
    include: { subject: { select: { id: true, slug: true, name: true } } },
    orderBy: { hourlyRateMinor: 'asc' },
  },
} satisfies Prisma.TeacherProfileInclude;

type PublicTeacher = Prisma.TeacherProfileGetPayload<{ include: typeof PUBLIC_INCLUDE }>;

function toCard(t: PublicTeacher) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.user.fullName,
    headline: t.headline,
    avatarUrl: t.avatarUrl,
    languages: t.languages,
    yearsExperience: t.yearsExperience,
    timezone: t.timezone,
    sessionDurations: t.sessionDurations,
    subjects: t.subjects.map((s) => ({ id: s.subject.id, slug: s.subject.slug, name: s.subject.name, hourlyRateMinor: s.hourlyRateMinor, currency: s.currency, levels: s.levels })),
    fromHourlyRateMinor: t.subjects[0]?.hourlyRateMinor ?? null,
  };
}

@Injectable()
export class TeachersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly subjects: SubjectsService,
  ) {}

  /** Server-side search, filtering, sorting and pagination in one indexed SQL query. */
  async search(q: SearchTeachersQuery) {
    const where: Prisma.Sql[] = [Prisma.sql`tp."approvalStatus" = 'APPROVED'`, Prisma.sql`u.status = 'ACTIVE'`, Prisma.sql`ts."isActive"`, Prisma.sql`s."isActive"`];
    if (q.subject) where.push(Prisma.sql`s.slug = ${q.subject}`);
    if (q.minPrice !== undefined) where.push(Prisma.sql`ts."hourlyRateMinor" >= ${q.minPrice}`);
    if (q.maxPrice !== undefined) where.push(Prisma.sql`ts."hourlyRateMinor" <= ${q.maxPrice}`);
    if (q.minExperience !== undefined) where.push(Prisma.sql`tp."yearsExperience" >= ${q.minExperience}`);
    if (q.language) where.push(Prisma.sql`EXISTS (SELECT 1 FROM unnest(tp.languages) l WHERE lower(l) = lower(${q.language}))`);
    if (q.availableOn) where.push(Prisma.sql`EXISTS (SELECT 1 FROM "TeacherAvailability" a WHERE a."teacherId" = tp.id AND a."dayOfWeek" = ${q.availableOn})`);
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where.push(Prisma.sql`(u."fullName" ILIKE ${like} OR tp.headline ILIKE ${like} OR s.name ILIKE ${like})`);
    }
    const order = {
      recommended: Prisma.sql`tp."yearsExperience" DESC, tp."approvedAt" ASC NULLS LAST`,
      price_asc: Prisma.sql`min_rate ASC`,
      price_desc: Prisma.sql`min_rate DESC`,
      experience: Prisma.sql`tp."yearsExperience" DESC`,
      newest: Prisma.sql`tp."approvedAt" DESC NULLS LAST`,
    }[q.sort];

    const rows = await this.prisma.$queryRaw<{ id: string; min_rate: number; total: bigint }[]>`
      SELECT tp.id, MIN(ts."hourlyRateMinor")::int AS min_rate, COUNT(*) OVER() AS total
        FROM "TeacherProfile" tp
        JOIN "User" u ON u.id = tp."userId"
        JOIN "TeacherSubject" ts ON ts."teacherId" = tp.id
        JOIN "Subject" s ON s.id = ts."subjectId"
       WHERE ${Prisma.join(where, ' AND ')}
    GROUP BY tp.id
    ORDER BY ${order}, tp.id
       LIMIT ${q.pageSize} OFFSET ${q.skip}`;

    const ids = rows.map((r) => r.id);
    const profiles = ids.length ? await this.prisma.teacherProfile.findMany({ where: { id: { in: ids } }, include: PUBLIC_INCLUDE }) : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const total = rows.length ? Number(rows[0].total) : 0;
    return {
      data: ids.map((id) => toCard(byId.get(id)!)),
      meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
    };
  }

  async publicProfile(slug: string) {
    const t = await this.prisma.teacherProfile.findFirst({
      where: { slug, approvalStatus: 'APPROVED', user: { status: 'ACTIVE' } },
      include: PUBLIC_INCLUDE,
    });
    if (!t) throw AppError.notFound('Teacher');
    const [completed, cancellation] = await Promise.all([
      this.prisma.booking.count({ where: { teacherId: t.id, status: 'COMPLETED' } }),
      this.settings.get('policy.cancellation'),
    ]);
    return {
      ...toCard(t),
      bio: t.bio,
      qualifications: t.qualifications,
      bufferMinutes: t.bufferMinutes,
      minNoticeMinutes: t.minNoticeMinutes,
      maxAdvanceDays: t.maxAdvanceDays,
      completedSessions: completed,
      cancellationPolicy: cancellation,
    };
  }

  /** Price breakdown shown before payment; identical to what reserve() will charge. */
  async quote(teacherId: string, subjectId: string, durationMinutes: number) {
    const ts = await this.prisma.teacherSubject.findUnique({
      where: { teacherId_subjectId: { teacherId, subjectId } },
      include: { teacher: true },
    });
    if (!ts || !ts.isActive || ts.teacher.approvalStatus !== 'APPROVED') throw AppError.notFound('Teacher subject');
    if (!ts.teacher.sessionDurations.includes(durationMinutes))
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Session length not offered');
    const [pricing, cancellation, reschedule, rules] = await Promise.all([
      this.settings.get('pricing.rules'),
      this.settings.get('policy.cancellation'),
      this.settings.get('policy.reschedule'),
      this.settings.get('booking.rules'),
    ]);
    return {
      currency: pricing.currency,
      durationMinutes,
      hourlyRateMinor: ts.hourlyRateMinor,
      ...calculatePrice(ts.hourlyRateMinor, durationMinutes, pricing),
      platformFeeBps: pricing.platformFeeBps,
      taxBps: pricing.taxBps,
      taxBase: pricing.taxBase,
      holdMinutes: rules.holdMinutes,
      policy: { cancellation, reschedule },
    };
  }

  // ---- teacher self-service ----

  async mine(teacherId: string) {
    const t = await this.prisma.teacherProfile.findUniqueOrThrow({
      where: { id: teacherId },
      include: { user: { select: { fullName: true, email: true } }, subjects: { include: { subject: { select: { id: true, slug: true, name: true } } } } },
    });
    const pricing = await this.settings.get('pricing.rules');
    const flags = await this.settings.get('features.flags');
    return {
      ...t,
      pricingBounds: { minHourlyRateMinor: pricing.minHourlyRateMinor, maxHourlyRateMinor: pricing.maxHourlyRateMinor },
      canSetPricing: flags.teacherSelfPricing,
      profileComplete: t.headline.length >= 10 && t.bio.length >= 50 && t.subjects.length > 0,
    };
  }

  async updateProfile(teacherId: string, dto: UpdateTeacherProfileDto) {
    await this.prisma.teacherProfile.update({
      where: { id: teacherId },
      data: { ...dto, qualifications: dto.qualifications as unknown as Prisma.InputJsonValue },
    });
    return this.mine(teacherId);
  }

  async replaceSubjects(teacherId: string, dto: ReplaceTeacherSubjectsDto) {
    const [pricing, flags] = await Promise.all([this.settings.get('pricing.rules'), this.settings.get('features.flags')]);
    const existing = await this.prisma.teacherSubject.findMany({ where: { teacherId } });
    const ids = [...new Set(dto.subjects.map((s) => s.subjectId))];
    if (ids.length !== dto.subjects.length) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Duplicate subjects');
    const valid = await this.prisma.subject.count({ where: { id: { in: ids }, isActive: true } });
    if (valid !== ids.length) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Unknown or inactive subject');

    for (const s of dto.subjects) {
      const prev = existing.find((e) => e.subjectId === s.subjectId);
      if (!flags.teacherSelfPricing && prev && prev.hourlyRateMinor !== s.hourlyRateMinor)
        throw AppError.forbidden('Pricing changes are managed by the platform administrators');
      if (s.hourlyRateMinor < pricing.minHourlyRateMinor || s.hourlyRateMinor > pricing.maxHourlyRateMinor)
        throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `Hourly rate must be between ${pricing.minHourlyRateMinor / 100} and ${pricing.maxHourlyRateMinor / 100} ${pricing.currency}`);
    }
    await this.prisma.$transaction(async (tx) => {
      // Deactivate rather than delete subjects that have booking history.
      await tx.teacherSubject.updateMany({ where: { teacherId, subjectId: { notIn: ids } }, data: { isActive: false } });
      for (const s of dto.subjects) {
        await tx.teacherSubject.upsert({
          where: { teacherId_subjectId: { teacherId, subjectId: s.subjectId } },
          create: { teacherId, subjectId: s.subjectId, hourlyRateMinor: s.hourlyRateMinor, levels: s.levels, isActive: s.isActive ?? true },
          update: { hourlyRateMinor: s.hourlyRateMinor, levels: s.levels, isActive: s.isActive ?? true },
        });
      }
    });
    await this.subjects.invalidate();
    return this.mine(teacherId);
  }

  async overview(teacherId: string, userId: string) {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [upcoming, thisWeek, completed30, earnings30, next, connection, profile, pendingRefunds] = await Promise.all([
      this.prisma.booking.count({ where: { teacherId, status: 'CONFIRMED', startAt: { gte: now } } }),
      this.prisma.booking.count({ where: { teacherId, status: 'CONFIRMED', startAt: { gte: now, lt: weekAhead } } }),
      this.prisma.booking.count({ where: { teacherId, status: 'COMPLETED', startAt: { gte: monthAgo } } }),
      this.prisma.booking.aggregate({ where: { teacherId, status: { in: ['COMPLETED', 'CONFIRMED'] }, startAt: { gte: monthAgo, lt: now } }, _sum: { priceMinor: true } }),
      this.prisma.booking.findMany({
        where: { teacherId, status: 'CONFIRMED', endAt: { gte: now } },
        orderBy: { startAt: 'asc' },
        take: 5,
        include: { subject: { select: { name: true } }, student: { select: { fullName: true } }, meeting: { select: { status: true } } },
      }),
      this.prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: 'GOOGLE' } }, select: { status: true, lastError: true } }),
      this.prisma.teacherProfile.findUniqueOrThrow({ where: { id: teacherId }, select: { approvalStatus: true, headline: true, bio: true, _count: { select: { subjects: true, availability: true } } } }),
      this.prisma.booking.count({ where: { teacherId, refunds: { some: { status: { in: ['PENDING', 'SUBMITTED'] } } } } }),
    ]);
    return {
      approvalStatus: profile.approvalStatus,
      checklist: {
        profile: profile.headline.length >= 10 && profile.bio.length >= 50,
        subjects: profile._count.subjects > 0,
        availability: profile._count.availability > 0,
        calendar: connection?.status === 'ACTIVE',
      },
      stats: { upcoming, thisWeek, completedLast30Days: completed30, earningsLast30DaysMinor: earnings30._sum.priceMinor ?? 0, pendingRefunds },
      calendar: connection ?? null,
      nextSessions: next.map((b) => ({ id: b.id, startAt: b.startAt, endAt: b.endAt, subject: b.subject.name, student: b.student.fullName, meetingStatus: b.meeting?.status ?? null })),
    };
  }
}
