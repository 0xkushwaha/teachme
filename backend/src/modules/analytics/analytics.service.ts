import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [users, teachers, bookingsByStatus, revenue, refunds, daily, topSubjects, failedJobs, openDiscrepancies, openTickets] = await Promise.all([
      this.prisma.user.groupBy({ by: ['role'], where: { status: { not: 'DELETED' } }, _count: { _all: true } }),
      this.prisma.teacherProfile.groupBy({ by: ['approvalStatus'], _count: { _all: true } }),
      this.prisma.booking.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: { capturedAt: { gte: since }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amountMinor: true }, _count: { _all: true } }),
      this.prisma.refund.aggregate({ where: { processedAt: { gte: since }, status: 'PROCESSED' }, _sum: { amountMinor: true } }),
      this.prisma.$queryRaw<{ day: Date; bookings: bigint; confirmed: bigint; revenue: bigint }[]>`
        SELECT date_trunc('day', b."createdAt") AS day,
               COUNT(*) AS bookings,
               COUNT(*) FILTER (WHERE b.status IN ('CONFIRMED','COMPLETED')) AS confirmed,
               COALESCE(SUM(b."totalMinor") FILTER (WHERE b.status IN ('CONFIRMED','COMPLETED')), 0) AS revenue
          FROM "Booking" b
         WHERE b."createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ name: string; bookings: bigint }[]>`
        SELECT s.name, COUNT(*) AS bookings
          FROM "Booking" b JOIN "Subject" s ON s.id = b."subjectId"
         WHERE b."createdAt" >= ${since} AND b.status IN ('CONFIRMED','COMPLETED')
      GROUP BY s.name ORDER BY bookings DESC LIMIT 8`,
      this.prisma.jobRecord.count({ where: { status: { in: ['FAILED', 'DEAD'] } } }),
      this.prisma.payment.count({ where: { discrepancy: { not: null }, discrepancyResolvedAt: null } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    ]);
    const created = bookingsByStatus.reduce((a, b) => a + b._count._all, 0);
    const confirmed = bookingsByStatus.filter((b) => b.status === 'CONFIRMED' || b.status === 'COMPLETED').reduce((a, b) => a + b._count._all, 0);
    return {
      windowDays: days,
      users: Object.fromEntries(users.map((u) => [u.role, u._count._all])),
      teachers: Object.fromEntries(teachers.map((t) => [t.approvalStatus, t._count._all])),
      bookings: { created, confirmed, conversionRate: created ? confirmed / created : 0, byStatus: Object.fromEntries(bookingsByStatus.map((b) => [b.status, b._count._all])) },
      revenue: { grossMinor: revenue._sum.amountMinor ?? 0, payments: revenue._count._all, refundedMinor: refunds._sum.amountMinor ?? 0 },
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), bookings: Number(d.bookings), confirmed: Number(d.confirmed), revenueMinor: Number(d.revenue) })),
      topSubjects: topSubjects.map((s) => ({ name: s.name, bookings: Number(s.bookings) })),
      ops: { failedJobs, openDiscrepancies, openTickets },
    };
  }
}
