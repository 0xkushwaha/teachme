import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
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
