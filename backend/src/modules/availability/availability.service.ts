import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../../database/prisma.service';
import { AppError, ErrorCode } from '../../common/errors';
import { SettingsService } from '../../services/settings.service';
import { isValidTimezone } from '../../utils/time';
import { computeSlots, isSlotAvailable, Slot, SlotQuery } from './slot-engine';
import { CreateExceptionDto, TeachingSettingsDto, WeeklyWindowDto } from './dto/availability.dto';
import { mergeRanges } from './slot-engine';

const DAY = 86_400_000;
const MAX_RANGE_DAYS = 42;

type TeacherForSlots = {
  id: string;
  timezone: string;
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
};

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Inputs for the slot engine. Busy ranges ignore stale (expired) holds and, optionally, one booking. */
  private async buildQuery(
    teacher: TeacherForSlots,
    from: Date,
    to: Date,
    durationMinutes: number,
    excludeBookingId?: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<Omit<SlotQuery, 'rangeStart' | 'rangeEnd'> & { rangeStart: number; rangeEnd: number }> {
    const rules = await this.settings.get('booking.rules');
    const now = new Date();
    const pad = new Date(from.getTime() - DAY);
    const padEnd = new Date(to.getTime() + DAY);
    const [windows, exceptions, busy] = await Promise.all([
      db.teacherAvailability.findMany({ where: { teacherId: teacher.id } }),
      db.availabilityException.findMany({ where: { teacherId: teacher.id, startAt: { lt: padEnd }, endAt: { gt: pad } } }),
      db.booking.findMany({
        where: {
          teacherId: teacher.id,
          startAt: { lt: padEnd },
          blockedUntil: { gt: pad },
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
          OR: [{ status: { in: ['CONFIRMED', 'COMPLETED'] } }, { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } }],
        },
        select: { startAt: true, blockedUntil: true },
      }),
    ]);
    return {
      timezone: teacher.timezone,
      windows,
      exceptions: exceptions.map((e) => ({ type: e.type, start: e.startAt.getTime(), end: e.endAt.getTime() })),
      busy: busy.map((b) => ({ start: b.startAt.getTime(), end: b.blockedUntil.getTime() })),
      rangeStart: from.getTime(),
      rangeEnd: to.getTime(),
      durationMinutes,
      bufferMinutes: teacher.bufferMinutes,
      stepMinutes: rules.slotStepMinutes,
      now: now.getTime(),
      minNoticeMinutes: teacher.minNoticeMinutes,
      maxAdvanceDays: teacher.maxAdvanceDays,
    };
  }

  async slots(teacherId: string, fromIso: string, toIso: string, durationMinutes: number): Promise<{ timezone: string; slots: Slot[] }> {
    const teacher = await this.prisma.teacherProfile.findFirst({
      where: { id: teacherId, approvalStatus: 'APPROVED', user: { status: 'ACTIVE' } },
    });
    if (!teacher) throw AppError.notFound('Teacher');
    if (!teacher.sessionDurations.includes(durationMinutes))
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'This teacher does not offer that session length');
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (!(to > from) || to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY)
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `Range must be positive and at most ${MAX_RANGE_DAYS} days`);
    const q = await this.buildQuery(teacher, from, to, durationMinutes);
    return { timezone: teacher.timezone, slots: computeSlots(q) };
  }

  /** Server-side validation used by booking creation and reschedule (in addition to the DB constraint). */
  async isBookable(teacher: TeacherForSlots, startAt: Date, durationMinutes: number, excludeBookingId?: string, db?: Tx) {
    const q = await this.buildQuery(teacher, startAt, new Date(startAt.getTime() + durationMinutes * 60_000), durationMinutes, excludeBookingId, db);
    return isSlotAvailable(q, startAt);
  }

  // ---- Teacher self-service ----

  async getMine(teacherId: string) {
    const [teacher, windows, exceptions] = await Promise.all([
      this.prisma.teacherProfile.findUniqueOrThrow({
        where: { id: teacherId },
        select: { timezone: true, sessionDurations: true, bufferMinutes: true, minNoticeMinutes: true, maxAdvanceDays: true },
      }),
      this.prisma.teacherAvailability.findMany({ where: { teacherId }, orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] }),
      this.prisma.availabilityException.findMany({
        where: { teacherId, endAt: { gt: new Date() } },
        orderBy: { startAt: 'asc' },
        take: 200,
      }),
    ]);
    const rules = await this.settings.get('booking.rules');
    return { settings: teacher, allowedDurations: rules.allowedDurations, windows, exceptions };
  }

  async replaceWeekly(teacherId: string, windows: WeeklyWindowDto[]) {
    for (const w of windows) {
      if (w.endMinute <= w.startMinute)
        throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Each window must end after it starts');
    }
    // Merge overlapping windows per day so the stored rules are canonical.
    const merged: WeeklyWindowDto[] = [];
    for (let d = 1; d <= 7; d++) {
      const day = mergeRanges(windows.filter((w) => w.dayOfWeek === d).map((w) => ({ start: w.startMinute, end: w.endMinute })));
      merged.push(...day.map((r) => ({ dayOfWeek: d, startMinute: r.start, endMinute: r.end })));
    }
    await this.prisma.$transaction([
      this.prisma.teacherAvailability.deleteMany({ where: { teacherId } }),
      this.prisma.teacherAvailability.createMany({ data: merged.map((w) => ({ ...w, teacherId })) }),
    ]);
    return this.getMine(teacherId);
  }

  async addException(teacherId: string, dto: CreateExceptionDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (!(endAt > startAt)) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'End must be after start');
    if (endAt.getTime() - startAt.getTime() > 120 * DAY)
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'An exception can span at most 120 days');
    const created = await this.prisma.availabilityException.create({
      data: { teacherId, type: dto.type, startAt, endAt, reason: dto.reason },
    });
    // Existing confirmed bookings are not cancelled automatically; surface them so the teacher can act.
    const affected = dto.type === 'UNAVAILABLE'
      ? await this.prisma.booking.count({ where: { teacherId, status: 'CONFIRMED', startAt: { lt: endAt }, endAt: { gt: startAt } } })
      : 0;
    return { exception: created, affectedConfirmedBookings: affected };
  }

  async removeException(teacherId: string, id: string) {
    const res = await this.prisma.availabilityException.deleteMany({ where: { id, teacherId } });
    if (!res.count) throw AppError.notFound('Exception');
  }

  async updateSettings(teacherId: string, dto: TeachingSettingsDto) {
    const rules = await this.settings.get('booking.rules');
    if (dto.sessionDurations) {
      const bad = dto.sessionDurations.filter((d) => !rules.allowedDurations.includes(d));
      if (bad.length || !dto.sessionDurations.length)
        throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `Session lengths must be chosen from ${rules.allowedDurations.join(', ')} minutes`);
    }
    if (dto.timezone && !isValidTimezone(dto.timezone)) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Unknown timezone');
    const data: Prisma.TeacherProfileUpdateInput = {
      ...(dto.sessionDurations ? { sessionDurations: [...new Set(dto.sessionDurations)].sort((a, b) => a - b) } : {}),
      ...(dto.bufferMinutes !== undefined ? { bufferMinutes: dto.bufferMinutes } : {}),
      ...(dto.minNoticeMinutes !== undefined ? { minNoticeMinutes: dto.minNoticeMinutes } : {}),
      ...(dto.maxAdvanceDays !== undefined ? { maxAdvanceDays: dto.maxAdvanceDays } : {}),
      ...(dto.timezone ? { timezone: dto.timezone } : {}),
    };
    await this.prisma.teacherProfile.update({ where: { id: teacherId }, data });
    return this.getMine(teacherId);
  }
}
