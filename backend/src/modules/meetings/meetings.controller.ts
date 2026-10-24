import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { AppError, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { JobQueueService } from '../../jobs/job-queue.service';
import { JOBS, jobKey, QUEUES } from '../../jobs/queues';
import { BookingsService } from '../bookings/bookings.service';
import { CalendarSyncService } from '../calendar/calendar-sync.service';

@ApiTags('meetings')
@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly sync: CalendarSyncService,
    private readonly jobs: JobQueueService,
  ) {}

  /** Meet details for an authorized participant of a confirmed booking. */
  @Get('booking/:bookingId')
  async get(@CurrentUser() user: AuthUser, @Param('bookingId', ParseUUIDPipe) bookingId: string) {
    const booking = await this.bookings.loadAuthorized(user, bookingId);
    const meeting = await this.prisma.meeting.findUnique({ where: { bookingId } });
    const visible = booking.status === 'CONFIRMED' || booking.status === 'COMPLETED';
    return {
      status: meeting?.status ?? 'PENDING',
      joinUrl: visible && meeting?.status === 'READY' ? meeting.joinUrl : null,
      lastError: user.role === 'STUDENT' ? null : (meeting?.lastError ?? null),
    };
  }

  /** Safe retry: issues a new conference request id and re-runs calendar sync for this booking. */
  @Roles('TEACHER', 'ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('booking/:bookingId/retry')
  async retry(@CurrentUser() user: AuthUser, @Param('bookingId', ParseUUIDPipe) bookingId: string) {
    const booking = await this.bookings.loadAuthorized(user, bookingId);
    if (booking.status !== 'CONFIRMED') throw AppError.unprocessable(ErrorCode.BOOKING_INVALID_STATE, 'Only confirmed sessions can get a meeting');
    const meeting = await this.prisma.meeting.findUnique({ where: { bookingId } });
    if (meeting?.status === 'READY') return { status: 'READY' };
    await this.sync.resetMeeting(bookingId);
    await this.jobs.enqueue(QUEUES.integrations, JOBS.calendarSync, { bookingId }, {
      key: jobKey('calendar', 'sync', bookingId, 'retry', Date.now()),
      track: true,
      entityType: 'Booking',
      entityId: bookingId,
    });
    return { status: 'PENDING' };
  }
}
