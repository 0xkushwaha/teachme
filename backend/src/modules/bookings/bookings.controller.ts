import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, Idempotent, RequireVerifiedEmail, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { AppError } from '../../common/errors';
import { BookingsService } from './bookings.service';
import { BOOKING_INCLUDE, toIcs } from './booking.mapper';
import { CalendarRangeQuery, CancelBookingDto, CreateBookingDto, ListBookingsQuery, RescheduleBookingDto } from './dto/bookings.dto';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** Reserve a slot (PENDING_PAYMENT hold). Follow with POST /payments/orders. Requires Idempotency-Key. */
  @Roles('STUDENT')
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Idempotent()
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    const booking = await this.bookings.reserve(user, dto);
    return this.bookings.view(user, booking.id);
  }

  @Roles('STUDENT', 'TEACHER')
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListBookingsQuery) {
    const { rows, total } = await this.bookings.list(user, q);
    return paginate(rows, total, q);
  }

  @Roles('TEACHER')
  @Get('teacher/calendar')
  calendar(@CurrentUser() user: AuthUser, @Query() q: CalendarRangeQuery) {
    return this.bookings.teacherCalendar(user, q.from, q.to);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.view(user, id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelBookingDto) {
    return this.bookings.cancel(user, id, dto.reason);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  @HttpCode(200)
  @Post(':id/reschedule')
  reschedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleBookingDto) {
    return this.bookings.reschedule(user, id, dto.startAt);
  }

  /** iCalendar file so students can add the session to any calendar without granting OAuth access. */
  @Get(':id/ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  async ics(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const b = await this.prisma.booking.findUnique({ where: { id }, include: BOOKING_INCLUDE });
    if (!b || !this.bookings.canAccess(user, b) || !['CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(b.status)) throw AppError.notFound('Booking');
    const meet = b.meeting?.status === 'READY' && b.status !== 'CANCELLED' ? b.meeting.joinUrl : null;
    res.setHeader('Content-Disposition', `attachment; filename="teachme-session-${b.id.slice(0, 8)}.ics"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(toIcs(b, meet, this.config.env.APP_URL));
  }
}
