import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';

class UpdateStudentProfileDto {
  @IsOptional() @IsString() @MaxLength(60) gradeLevel?: string;
  @IsOptional() @IsString() @MaxLength(1000) learningGoals?: string;
  @IsOptional() @IsString() @MaxLength(40) preferredLanguage?: string;
}

@ApiTags('students')
@Roles('STUDENT')
@Controller('students/me')
export class StudentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  profile(@CurrentUser() user: AuthUser) {
    return this.prisma.studentProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateStudentProfileDto) {
    return this.prisma.studentProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...dto }, update: dto });
  }

  /** Payment history: only payments that moved money (captured, refunded, or failed attempts). */
  @Get('payments')
  async payments(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) {
    const where: Prisma.PaymentWhereInput = { booking: { studentId: user.id }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED'] } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        select: {
          id: true, amountMinor: true, currency: true, status: true, method: true, capturedAt: true, refundedMinor: true, createdAt: true, failureReason: true,
          booking: { select: { id: true, startAt: true, durationMinutes: true, status: true, subject: { select: { name: true } }, teacher: { select: { user: { select: { fullName: true } } } } } },
          refunds: { select: { amountMinor: true, status: true, processedAt: true, createdAt: true } },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(
      rows.map((p) => ({ ...p, booking: { ...p.booking, subject: p.booking.subject.name, teacher: p.booking.teacher.user.fullName } })),
      total,
      q,
    );
  }

  /** Receipt for a captured payment. Students see only their own (404 otherwise). */
  @Get('payments/:id/receipt')
  async receipt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id, booking: { studentId: user.id }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      include: {
        booking: { include: { subject: { select: { name: true } }, teacher: { select: { user: { select: { fullName: true } } } }, student: { select: { fullName: true, email: true } } } },
        refunds: { where: { status: 'PROCESSED' }, select: { amountMinor: true, processedAt: true } },
      },
    });
    if (!p) throw AppError.notFound('Receipt');
    const b = p.booking;
    return {
      receiptNumber: `TM-${(p.capturedAt ?? p.createdAt).toISOString().slice(0, 10).replace(/-/g, '')}-${p.id.slice(0, 8).toUpperCase()}`,
      issuedAt: p.capturedAt ?? p.createdAt,
      provider: p.provider,
      providerPaymentId: p.providerPaymentId,
      method: p.method,
      currency: p.currency,
      billedTo: { name: b.student.fullName, email: b.student.email },
      session: { bookingId: b.id, subject: b.subject.name, teacher: b.teacher.user.fullName, startAt: b.startAt, durationMinutes: b.durationMinutes, timezone: b.studentTimezone, status: b.status },
      lines: [
        { label: `${b.subject.name} session (${b.durationMinutes} min)`, amountMinor: b.priceMinor },
        { label: 'Platform fee', amountMinor: b.platformFeeMinor },
        { label: 'Tax', amountMinor: b.taxMinor },
      ],
      totalMinor: b.totalMinor,
      paidMinor: p.amountMinor,
      refunds: p.refunds,
      refundedMinor: p.refundedMinor,
      netPaidMinor: p.amountMinor - p.refundedMinor,
    };
  }

  @Get('overview')
  async overview(@CurrentUser() user: AuthUser) {
    const now = new Date();
    const [upcoming, completed, pending, next, spent] = await Promise.all([
      this.prisma.booking.count({ where: { studentId: user.id, status: 'CONFIRMED', endAt: { gte: now } } }),
      this.prisma.booking.count({ where: { studentId: user.id, status: 'COMPLETED' } }),
      this.prisma.booking.findMany({
        where: { studentId: user.id, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        select: { id: true, startAt: true, holdExpiresAt: true, subject: { select: { name: true } }, teacher: { select: { user: { select: { fullName: true } } } } },
      }),
      this.prisma.booking.findMany({
        where: { studentId: user.id, status: 'CONFIRMED', endAt: { gte: now } },
        orderBy: { startAt: 'asc' },
        take: 3,
        include: {
          subject: { select: { name: true } },
          teacher: { select: { slug: true, avatarUrl: true, user: { select: { fullName: true } } } },
          meeting: { select: { status: true, joinUrl: true } },
        },
      }),
      this.prisma.payment.aggregate({ where: { booking: { studentId: user.id }, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amountMinor: true, refundedMinor: true } }),
    ]);
    return {
      stats: { upcoming, completed, totalSpentMinor: (spent._sum.amountMinor ?? 0) - (spent._sum.refundedMinor ?? 0) },
      pendingCheckouts: pending.map((p) => ({ id: p.id, startAt: p.startAt, holdExpiresAt: p.holdExpiresAt, subject: p.subject.name, teacher: p.teacher.user.fullName })),
      nextSessions: next.map((b) => ({
        id: b.id,
        startAt: b.startAt,
        endAt: b.endAt,
        subject: b.subject.name,
        teacher: { name: b.teacher.user.fullName, slug: b.teacher.slug, avatarUrl: b.teacher.avatarUrl },
        meeting: b.meeting ? { status: b.meeting.status, joinUrl: b.meeting.status === 'READY' ? b.meeting.joinUrl : null } : null,
      })),
    };
  }
}
