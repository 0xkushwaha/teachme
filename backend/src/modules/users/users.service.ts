import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { AppError, ErrorCode } from '../../common/errors';
import { AuditService } from '../../services/audit.service';
import { CALENDAR_GATEWAY, CalendarGateway } from '../../integrations/google/calendar-gateway';
import { decrypt, randomToken } from '../../utils/crypto';
import { isValidTimezone } from '../../utils/time';
import { PasswordService } from '../auth/password.service';
import { toSelfUser } from './user.mapper';
import { UpdateMeDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Inject(CALENDAR_GATEWAY) private readonly calendar: CalendarGateway,
  ) {}

  async update(userId: string, dto: UpdateMeDto) {
    if (dto.timezone && !isValidTimezone(dto.timezone)) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Unknown timezone');
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
      include: { teacherProfile: { select: { id: true, slug: true, approvalStatus: true } } },
    });
    return toSelfUser(user);
  }

  /** Data portability: everything we hold about the user, excluding secrets. */
  async export(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        studentProfile: true,
        teacherProfile: { include: { subjects: true, availability: true, availabilityExceptions: true } },
        notificationPreferences: true,
        supportTickets: true,
        calendarConnections: { select: { provider: true, accountEmail: true, status: true, connectedAt: true, scopes: true } },
      },
    });
    const bookings = await this.prisma.booking.findMany({
      where: { OR: [{ studentId: userId }, ...(user.teacherProfile ? [{ teacherId: user.teacherProfile.id }] : [])] },
      include: { payments: { select: { amountMinor: true, currency: true, status: true, createdAt: true, refundedMinor: true } }, refunds: { select: { amountMinor: true, status: true, createdAt: true } }, subject: { select: { name: true } } },
    });
    const notifications = await this.prisma.notification.findMany({ where: { userId }, select: { type: true, channel: true, title: true, status: true, createdAt: true } });
    await this.audit.record({ actorId: userId, action: 'privacy.data_exported', entityType: 'User', entityId: userId });
    const { passwordHash: _p, failedLoginCount: _f, lockedUntil: _l, ...profile } = user;
    return { exportedAt: new Date().toISOString(), profile, bookings, notifications };
  }

  /**
   * Account deletion: personal data is erased/pseudonymised immediately; booking and payment
   * records are retained (without contact details) for financial record-keeping obligations.
   */
  async delete(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { teacherProfile: true, calendarConnections: true } });
    if (!(await this.passwords.verify(user.passwordHash, password)))
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Password is incorrect', HttpStatus.BAD_REQUEST);
    if (user.role === 'ADMIN') throw AppError.forbidden('Admin accounts must be removed by another administrator');
    const upcoming = await this.prisma.booking.count({
      where: {
        status: { in: ['CONFIRMED', 'PENDING_PAYMENT'] },
        endAt: { gt: new Date() },
        OR: [{ studentId: userId }, ...(user.teacherProfile ? [{ teacherId: user.teacherProfile.id }] : [])],
      },
    });
    if (upcoming) throw AppError.unprocessable(ErrorCode.BOOKING_POLICY_VIOLATION, 'Cancel your upcoming sessions before deleting your account');

    for (const c of user.calendarConnections) {
      if (c.encryptedRefreshToken) await this.calendar.revoke(decrypt(c.encryptedRefreshToken, this.config.env.DATA_ENCRYPTION_KEY)).catch(() => undefined);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { userId } });
      await tx.verificationToken.deleteMany({ where: { userId } });
      await tx.calendarConnection.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.studentProfile.updateMany({ where: { userId }, data: { gradeLevel: null, learningGoals: null, preferredLanguage: null } });
      if (user.teacherProfile) {
        await tx.teacherProfile.update({
          where: { id: user.teacherProfile.id },
          data: { approvalStatus: 'SUSPENDED', bio: '', headline: '', avatarUrl: null, qualifications: [] },
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@deleted.invalid`,
          fullName: 'Deleted user',
          phone: null,
          passwordHash: `deleted:${randomToken()}`,
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });
      await this.audit.record({ actorId: userId, action: 'privacy.account_deleted', entityType: 'User', entityId: userId }, tx);
    });
  }
}
