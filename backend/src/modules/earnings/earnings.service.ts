import { Injectable } from '@nestjs/common';
import { PayoutStatus, Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';
import { isUniqueViolation } from '../../database/prisma-errors';
import { AppError, ErrorCode } from '../../common/errors';
import type { AuthUser } from '../../common/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { AuditService } from '../../services/audit.service';
import { OutboxService } from '../../services/outbox.service';
import { SettingsService } from '../../services/settings.service';
import { teacherEarningMinor } from '../../utils/money';

const OPEN: PayoutStatus[] = ['REQUESTED', 'APPROVED'];
const DAY_MS = 86_400_000;

type Page = { page: number; pageSize: number; skip: number };

/**
 * Teacher earnings ledger and manual payouts. All amounts are computed here on the server from
 * bookings and captured payments; teachers can only read their ledger and request payouts.
 */
@Injectable()
export class EarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Writes the SESSION earning for a booking that has just become COMPLETED. Call inside the same
   * transaction as the status change. Idempotent: the partial unique index allows one per booking.
   */
  async recordSessionEarning(tx: Tx, bookingId: string): Promise<number> {
    const b = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { id: true, teacherId: true, priceMinor: true, totalMinor: true, currency: true, status: true, endAt: true, completedAt: true, subject: { select: { name: true } } },
    });
    if (b.status !== 'COMPLETED') return 0;
    const paid = await tx.payment.aggregate({
      where: { bookingId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } },
      _sum: { amountMinor: true, refundedMinor: true },
    });
    const net = (paid._sum.amountMinor ?? 0) - (paid._sum.refundedMinor ?? 0);
    const amount = teacherEarningMinor(b.priceMinor, b.totalMinor, net);
    if (amount <= 0) return 0;
    const inserted = await tx.$executeRaw`
      INSERT INTO "TeacherEarning" (id, "teacherId", "bookingId", type, "amountMinor", currency, description, "earnedAt", "createdAt")
      VALUES (gen_random_uuid(), ${b.teacherId}::uuid, ${b.id}::uuid, 'SESSION', ${amount}, ${b.currency}, ${`${b.subject.name} session`},
              ${b.completedAt ?? b.endAt}, now())
      ON CONFLICT ("bookingId") WHERE type = 'SESSION' DO NOTHING`;
    return inserted ? amount : 0;
  }

  // ---------------- Teacher views ----------------

  async summary(teacherId: string) {
    const [rules, tz] = await Promise.all([
      this.settings.get('payouts.rules'),
      this.prisma.teacherProfile.findUniqueOrThrow({ where: { id: teacherId }, select: { timezone: true } }),
    ]);
    const now = new Date();
    const cutoff = new Date(now.getTime() - rules.clearingDays * DAY_MS);
    const [totals] = await this.prisma.$queryRaw<
      { lifetime: bigint; paid: bigint; in_payout: bigint; available: bigint; clearing: bigint; this_month: bigint; last_month: bigint }[]
    >`
      SELECT COALESCE(SUM(e."amountMinor"), 0)                                                         AS lifetime,
             COALESCE(SUM(e."amountMinor") FILTER (WHERE p.status = 'PAID'), 0)                         AS paid,
             COALESCE(SUM(e."amountMinor") FILTER (WHERE p.status IN ('REQUESTED', 'APPROVED')), 0)     AS in_payout,
             COALESCE(SUM(e."amountMinor") FILTER (WHERE e."payoutId" IS NULL AND e."earnedAt" <= ${cutoff}), 0) AS available,
             COALESCE(SUM(e."amountMinor") FILTER (WHERE e."payoutId" IS NULL AND e."earnedAt" > ${cutoff}), 0)  AS clearing,
             COALESCE(SUM(e."amountMinor") FILTER (WHERE e."earnedAt" >= date_trunc('month', now() AT TIME ZONE ${tz.timezone}) AT TIME ZONE ${tz.timezone}), 0) AS this_month,
             COALESCE(SUM(e."amountMinor") FILTER (
               WHERE e."earnedAt" >= (date_trunc('month', now() AT TIME ZONE ${tz.timezone}) - interval '1 month') AT TIME ZONE ${tz.timezone}
                 AND e."earnedAt" <  date_trunc('month', now() AT TIME ZONE ${tz.timezone}) AT TIME ZONE ${tz.timezone}), 0) AS last_month
        FROM "TeacherEarning" e
        LEFT JOIN "TeacherPayout" p ON p.id = e."payoutId"
       WHERE e."teacherId" = ${teacherId}::uuid`;
    const [upcoming, byStatus, recentTotal, recentCancelled, openPayout] = await Promise.all([
      this.prisma.booking.aggregate({ where: { teacherId, status: 'CONFIRMED' }, _sum: { priceMinor: true }, _count: true }),
      this.prisma.booking.groupBy({ by: ['status'], where: { teacherId, status: { in: ['CONFIRMED', 'COMPLETED', 'CANCELLED'] } }, _count: { _all: true } }),
      this.prisma.booking.count({ where: { teacherId, status: { in: ['CONFIRMED', 'COMPLETED', 'CANCELLED'] }, startAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } } }),
      this.prisma.booking.count({ where: { teacherId, status: 'CANCELLED', startAt: { gte: new Date(now.getTime() - 90 * DAY_MS) } } }),
      this.prisma.teacherPayout.findFirst({ where: { teacherId, status: { in: OPEN } }, select: { id: true, amountMinor: true, status: true, requestedAt: true } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
    const n = (v: bigint) => Number(v);
    const available = n(totals.available);
    return {
      currency: 'INR',
      lifetimeMinor: n(totals.lifetime),
      paidOutMinor: n(totals.paid),
      inPayoutMinor: n(totals.in_payout),
      availableMinor: available,
      clearingMinor: n(totals.clearing),
      /** Session prices of confirmed, not-yet-completed bookings: earned once each session completes. */
      pendingFromUpcomingMinor: upcoming._sum.priceMinor ?? 0,
      thisMonthMinor: n(totals.this_month),
      lastMonthMinor: n(totals.last_month),
      sessions: {
        completed: counts.COMPLETED ?? 0,
        upcoming: counts.CONFIRMED ?? 0,
        cancelled: counts.CANCELLED ?? 0,
        cancellationRate90d: recentTotal ? Math.round((recentCancelled / recentTotal) * 1000) / 10 : 0,
      },
      payouts: {
        enabled: rules.enabled,
        minPayoutMinor: rules.minPayoutMinor,
        clearingDays: rules.clearingDays,
        open: openPayout,
        canRequest: rules.enabled && !openPayout && available >= rules.minPayoutMinor,
      },
    };
  }

  /** Earnings and completed sessions per week (last 12) and month (last 12) in the teacher's timezone. */
  async series(teacherId: string) {
    const { timezone } = await this.prisma.teacherProfile.findUniqueOrThrow({ where: { id: teacherId }, select: { timezone: true } });
    const query = (unit: 'week' | 'month', count: number) => this.prisma.$queryRaw<{ period: Date; earnings: bigint; sessions: bigint }[]>`
      WITH periods AS (
        SELECT generate_series(date_trunc(${unit}, now() AT TIME ZONE ${timezone}) - (${count - 1} * ('1 ' || ${unit})::interval),
                               date_trunc(${unit}, now() AT TIME ZONE ${timezone}), ('1 ' || ${unit})::interval) AS period
      )
      SELECT p.period,
             COALESCE((SELECT SUM(e."amountMinor") FROM "TeacherEarning" e
                        WHERE e."teacherId" = ${teacherId}::uuid
                          AND date_trunc(${unit}, e."earnedAt" AT TIME ZONE ${timezone}) = p.period), 0) AS earnings,
             (SELECT COUNT(*) FROM "Booking" b
               WHERE b."teacherId" = ${teacherId}::uuid AND b.status = 'COMPLETED'
                 AND date_trunc(${unit}, b."endAt" AT TIME ZONE ${timezone}) = p.period) AS sessions
        FROM periods p ORDER BY p.period`;
    const [weekly, monthly] = await Promise.all([query('week', 12), query('month', 12)]);
    const map = (rows: { period: Date; earnings: bigint; sessions: bigint }[]) =>
      rows.map((r) => ({ period: r.period.toISOString().slice(0, 10), earningsMinor: Number(r.earnings), sessions: Number(r.sessions) }));
    return { timezone, weekly: map(weekly), monthly: map(monthly) };
  }

  async ledger(teacherId: string, q: Page) {
    const where: Prisma.TeacherEarningWhereInput = { teacherId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.teacherEarning.findMany({
        where,
        orderBy: { earnedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: {
          booking: { select: { id: true, startAt: true, durationMinutes: true, subject: { select: { name: true } }, student: { select: { fullName: true } } } },
          payout: { select: { id: true, status: true } },
        },
      }),
      this.prisma.teacherEarning.count({ where }),
    ]);
    return paginate(
      rows.map((e) => ({
        id: e.id,
        type: e.type,
        amountMinor: e.amountMinor,
        currency: e.currency,
        description: e.description,
        earnedAt: e.earnedAt,
        booking: e.booking ? { id: e.booking.id, startAt: e.booking.startAt, durationMinutes: e.booking.durationMinutes, subject: e.booking.subject.name, student: e.booking.student.fullName } : null,
        payout: e.payout,
      })),
      total,
      q,
    );
  }

  async payouts(teacherId: string, q: Page) {
    const where: Prisma.TeacherPayoutWhereInput = { teacherId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.teacherPayout.findMany({ where, orderBy: { requestedAt: 'desc' }, skip: q.skip, take: q.pageSize, include: { _count: { select: { earnings: true } } } }),
      this.prisma.teacherPayout.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  // ---------------- Payout lifecycle ----------------

  async requestPayout(teacher: AuthUser, note?: string) {
    const teacherId = teacher.teacherProfileId!;
    const rules = await this.settings.get('payouts.rules');
    if (!rules.enabled) throw new AppError(ErrorCode.FEATURE_DISABLED, 'Payout requests are currently disabled', 403);
    const cutoff = new Date(Date.now() - rules.clearingDays * DAY_MS);
    try {
      const payout = await this.prisma.$transaction(async (tx) => {
        // Serialise requests per teacher; the partial unique index is the last line of defence.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payout:${teacherId}`}, 0))`;
        const open = await tx.teacherPayout.count({ where: { teacherId, status: { in: OPEN } } });
        if (open) throw AppError.conflict(ErrorCode.CONFLICT, 'You already have a payout request in progress');
        const eligible = await tx.teacherEarning.aggregate({ where: { teacherId, payoutId: null, earnedAt: { lte: cutoff } }, _sum: { amountMinor: true } });
        const amount = eligible._sum.amountMinor ?? 0;
        if (amount < rules.minPayoutMinor)
          throw AppError.unprocessable(ErrorCode.VALIDATION_FAILED, `The minimum payout is ${rules.minPayoutMinor / 100} INR; your available balance is ${amount / 100} INR`);
        const created = await tx.teacherPayout.create({ data: { teacherId, amountMinor: amount, note: note?.trim() || null } });
        const allocated = await tx.teacherEarning.updateMany({ where: { teacherId, payoutId: null, earnedAt: { lte: cutoff } }, data: { payoutId: created.id } });
        const check = await tx.teacherEarning.aggregate({ where: { payoutId: created.id }, _sum: { amountMinor: true } });
        if ((check._sum.amountMinor ?? 0) !== amount || allocated.count === 0)
          throw AppError.conflict(ErrorCode.CONFLICT, 'Your balance changed while processing; please try again');
        await this.audit.record({ actorId: teacher.id, actorRole: 'TEACHER', action: 'payout.requested', entityType: 'TeacherPayout', entityId: created.id, metadata: { amountMinor: amount, entries: allocated.count } }, tx);
        await this.outbox.publish(tx, { type: 'payout.updated', aggregateId: created.id, payload: { payoutId: created.id, status: 'REQUESTED' } });
        return created;
      });
      return payout;
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict(ErrorCode.CONFLICT, 'You already have a payout request in progress');
      throw err;
    }
  }

  async cancelPayout(teacher: AuthUser, payoutId: string) {
    return this.changeStatus(payoutId, ['REQUESTED'], 'CANCELLED', { actor: teacher, ownerTeacherId: teacher.teacherProfileId!, release: true });
  }

  async adminList(q: Page & { status?: PayoutStatus; teacherId?: string }) {
    const where: Prisma.TeacherPayoutWhereInput = { ...(q.status ? { status: q.status } : {}), ...(q.teacherId ? { teacherId: q.teacherId } : {}) };
    const [rows, total, totals] = await this.prisma.$transaction([
      this.prisma.teacherPayout.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
        include: { teacher: { select: { id: true, slug: true, user: { select: { fullName: true, email: true } } } }, _count: { select: { earnings: true } } },
      }),
      this.prisma.teacherPayout.count({ where }),
      this.prisma.teacherPayout.groupBy({ by: ['status'], orderBy: { status: 'asc' }, _sum: { amountMinor: true }, _count: { _all: true } }),
    ]);
    return { ...paginate(rows, total, q), totals: totals.map((t) => ({ status: t.status, count: (t._count as { _all: number })._all, amountMinor: t._sum?.amountMinor ?? 0 })) };
  }

  approve(admin: AuthUser, payoutId: string, note?: string) {
    return this.changeStatus(payoutId, ['REQUESTED'], 'APPROVED', { actor: admin, note });
  }

  markPaid(admin: AuthUser, payoutId: string, reference: string, note?: string) {
    return this.changeStatus(payoutId, ['APPROVED'], 'PAID', { actor: admin, note, reference });
  }

  reject(admin: AuthUser, payoutId: string, reason: string) {
    return this.changeStatus(payoutId, ['REQUESTED', 'APPROVED'], 'REJECTED', { actor: admin, reason, release: true });
  }

  /** Compare-and-set status change; rejected/cancelled payouts return their earnings to the available balance. */
  private async changeStatus(
    payoutId: string,
    from: PayoutStatus[],
    to: PayoutStatus,
    o: { actor: AuthUser; ownerTeacherId?: string; note?: string; reason?: string; reference?: string; release?: boolean },
  ) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.teacherPayout.findUnique({ where: { id: payoutId } });
      if (!p || (o.ownerTeacherId && p.teacherId !== o.ownerTeacherId)) throw AppError.notFound('Payout');
      const res = await tx.teacherPayout.updateMany({
        where: { id: payoutId, status: { in: from } },
        data: {
          status: to,
          ...(o.actor.role === 'ADMIN' ? { decidedAt: now, decidedById: o.actor.id } : {}),
          ...(to === 'PAID' ? { paidAt: now, reference: o.reference } : {}),
          ...(o.reason ? { rejectionReason: o.reason } : {}),
          ...(o.note ? { note: o.note } : {}),
        },
      });
      if (res.count !== 1)
        throw AppError.unprocessable(ErrorCode.CONFLICT, `Only ${from.map((s) => s.toLowerCase()).join(' or ')} payouts can be marked ${to.toLowerCase()}`);
      if (o.release) await tx.teacherEarning.updateMany({ where: { payoutId }, data: { payoutId: null } });
      await this.audit.record(
        {
          actorId: o.actor.id,
          actorRole: o.actor.role,
          action: `payout.${to.toLowerCase()}`,
          entityType: 'TeacherPayout',
          entityId: payoutId,
          metadata: { from: p.status, to, amountMinor: p.amountMinor, reference: o.reference ?? null, reason: o.reason ?? null },
        },
        tx,
      );
      await this.outbox.publish(tx, { type: 'payout.updated', aggregateId: payoutId, payload: { payoutId, status: to } });
      return tx.teacherPayout.findUniqueOrThrow({ where: { id: payoutId } });
    });
  }

  /** Admin correction (e.g. a dispute resolved after completion). Never edits existing rows. */
  async addAdjustment(admin: AuthUser, teacherId: string, amountMinor: number, description: string) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { id: teacherId }, select: { id: true } });
    if (!t) throw AppError.notFound('Topper');
    return this.prisma.$transaction(async (tx) => {
      const e = await tx.teacherEarning.create({
        data: { teacherId, type: 'ADJUSTMENT', amountMinor, description, earnedAt: new Date(), createdById: admin.id },
      });
      await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.earning_adjusted', entityType: 'TeacherProfile', entityId: teacherId, metadata: { earningId: e.id, amountMinor, description } }, tx);
      return e;
    });
  }

  // ---------------- Platform finance ----------------

  async financeSummary(from: Date, to: Date) {
    const [collected, refunded, fees, earned, paidOut, liability, open, topTeachers] = await Promise.all([
      this.prisma.payment.aggregate({ where: { capturedAt: { gte: from, lt: to }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.refund.aggregate({ where: { status: 'PROCESSED', processedAt: { gte: from, lt: to } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.booking.aggregate({
        where: { payments: { some: { capturedAt: { gte: from, lt: to }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } } },
        _sum: { platformFeeMinor: true, taxMinor: true, priceMinor: true },
      }),
      this.prisma.teacherEarning.aggregate({ where: { earnedAt: { gte: from, lt: to } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.teacherPayout.aggregate({ where: { status: 'PAID', paidAt: { gte: from, lt: to } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.$queryRaw<{ owed: bigint }[]>`
        SELECT COALESCE(SUM(e."amountMinor"), 0) AS owed FROM "TeacherEarning" e
          LEFT JOIN "TeacherPayout" p ON p.id = e."payoutId"
         WHERE p.id IS NULL OR p.status <> 'PAID'`,
      this.prisma.teacherPayout.aggregate({ where: { status: { in: OPEN } }, _sum: { amountMinor: true }, _count: true }),
      this.prisma.$queryRaw<{ teacher_id: string; name: string; earned: bigint; sessions: bigint }[]>`
        SELECT e."teacherId" AS teacher_id, u."fullName" AS name, SUM(e."amountMinor") AS earned, COUNT(e."bookingId") AS sessions
          FROM "TeacherEarning" e
          JOIN "TeacherProfile" tp ON tp.id = e."teacherId"
          JOIN "User" u ON u.id = tp."userId"
         WHERE e."earnedAt" >= ${from} AND e."earnedAt" < ${to}
         GROUP BY 1, 2 ORDER BY earned DESC LIMIT 10`,
    ]);
    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      collectedMinor: collected._sum.amountMinor ?? 0,
      payments: collected._count,
      refundedMinor: refunded._sum.amountMinor ?? 0,
      refunds: refunded._count,
      netCollectedMinor: (collected._sum.amountMinor ?? 0) - (refunded._sum.amountMinor ?? 0),
      platformFeeMinor: fees._sum.platformFeeMinor ?? 0,
      taxMinor: fees._sum.taxMinor ?? 0,
      teacherEarningsMinor: earned._sum.amountMinor ?? 0,
      payoutsPaidMinor: paidOut._sum.amountMinor ?? 0,
      payoutsPaid: paidOut._count,
      /** Point-in-time: everything earned by teachers and not yet paid out. */
      outstandingTeacherBalanceMinor: Number(liability[0]?.owed ?? 0),
      openPayouts: { count: open._count, amountMinor: open._sum.amountMinor ?? 0 },
      topTeachers: topTeachers.map((t) => ({ teacherId: t.teacher_id, name: t.name, earnedMinor: Number(t.earned), sessions: Number(t.sessions) })),
    };
  }

  /** One row per paid booking in the range. Bounded so a report can never exhaust memory. */
  async financeCsv(from: Date, to: Date): Promise<string> {
    const rows = await this.prisma.$queryRaw<
      { booking_id: string; captured_at: Date; session_at: Date; status: string; student: string; teacher: string; subject: string; price: number; fee: number; tax: number; total: number; paid: number; refunded: number; earning: bigint | null; payout_status: string | null }[]
    >`
      SELECT b.id AS booking_id, p."capturedAt" AS captured_at, b."startAt" AS session_at, b.status::text AS status,
             su."fullName" AS student, tu."fullName" AS teacher, s.name AS subject,
             b."priceMinor" AS price, b."platformFeeMinor" AS fee, b."taxMinor" AS tax, b."totalMinor" AS total,
             p."amountMinor" AS paid, p."refundedMinor" AS refunded,
             (SELECT SUM(e."amountMinor") FROM "TeacherEarning" e WHERE e."bookingId" = b.id) AS earning,
             (SELECT tp2.status::text FROM "TeacherEarning" e2 JOIN "TeacherPayout" tp2 ON tp2.id = e2."payoutId" WHERE e2."bookingId" = b.id LIMIT 1) AS payout_status
        FROM "Payment" p
        JOIN "Booking" b ON b.id = p."bookingId"
        JOIN "User" su ON su.id = b."studentId"
        JOIN "TeacherProfile" t ON t.id = b."teacherId"
        JOIN "User" tu ON tu.id = t."userId"
        JOIN "Subject" s ON s.id = b."subjectId"
       WHERE p."capturedAt" >= ${from} AND p."capturedAt" < ${to}
         AND p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
       ORDER BY p."capturedAt"
       LIMIT 50000`;
    const header = ['booking_id', 'captured_at', 'session_at', 'status', 'student', 'topper', 'subject', 'price', 'platform_fee', 'tax', 'total', 'paid', 'refunded', 'topper_earning', 'payout_status'];
    const money = (v: number | bigint | null) => (v === null ? '' : (Number(v) / 100).toFixed(2));
    const lines = rows.map((r) =>
      [r.booking_id, r.captured_at.toISOString(), r.session_at.toISOString(), r.status, r.student, r.teacher, r.subject, money(r.price), money(r.fee), money(r.tax), money(r.total), money(r.paid), money(r.refunded), money(r.earning), r.payout_status ?? '']
        .map(csvCell)
        .join(','),
    );
    return [header.join(','), ...lines].join('\r\n') + '\r\n';
  }
}

/** RFC 4180 quoting plus spreadsheet formula-injection neutralisation. */
export function csvCell(value: string): string {
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
