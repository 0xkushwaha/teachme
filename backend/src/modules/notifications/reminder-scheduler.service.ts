import { Injectable } from '@nestjs/common';
import { Booking } from '@prisma/client';
import { JobQueueService } from '../../jobs/job-queue.service';
import { JOBS, jobKey, QUEUES } from '../../jobs/queues';
import { SettingsService } from '../../services/settings.service';

export interface ReminderPlan {
  offsetMinutes: number;
  fireAt: Date;
  key: string;
}

/**
 * Pure planning: which reminders a booking should get. Offsets whose fire time has already
 * passed when the booking is confirmed/rescheduled are skipped (no "24h" reminder for a
 * session booked 2 hours ahead). Keys embed the start time, so a reschedule yields new jobs
 * and the old ones become no-ops.
 */
export function planReminders(
  booking: Pick<Booking, 'id' | 'startAt'>,
  offsetsMinutes: number[],
  now: Date,
): ReminderPlan[] {
  return [...new Set(offsetsMinutes)]
    .map((offsetMinutes) => ({
      offsetMinutes,
      fireAt: new Date(booking.startAt.getTime() - offsetMinutes * 60_000),
      key: jobKey('reminder', booking.id, offsetMinutes, booking.startAt.getTime()),
    }))
    .filter((p) => p.fireAt.getTime() > now.getTime());
}

/**
 * A reminder is superseded when a smaller configured offset is already due: after an outage we
 * send only the most relevant reminder instead of a "starts in 24 hours" email an hour before.
 */
export function isSuperseded(offsetMinutes: number, offsetsMinutes: number[], minutesUntilStart: number): boolean {
  return offsetsMinutes.some((o) => o < offsetMinutes && minutesUntilStart <= o);
}

/** Human wording from the real time remaining (never the nominal offset, which may be stale). */
export function describeRemaining(minutesUntilStart: number): string {
  const m = Math.max(1, Math.round(minutesUntilStart));
  if (m >= 1380) {
    const days = Math.round(m / 1440);
    return days <= 1 ? 'in 24 hours' : `in ${days} days`;
  }
  if (m >= 90) return `in ${Math.round(m / 60)} hours`;
  if (m >= 55) return 'in 1 hour';
  return `in ${m} minutes`;
}

export function describeOffset(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'in 24 hours' : `in ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'in 1 hour' : `in ${minutes / 60} hours`;
  return `in ${minutes} minutes`;
}

@Injectable()
export class ReminderSchedulerService {
  constructor(
    private readonly jobs: JobQueueService,
    private readonly settings: SettingsService,
  ) {}

  async schedule(booking: Pick<Booking, 'id' | 'startAt'>, now = new Date()) {
    const { offsetsMinutes } = await this.settings.get('notifications.reminders');
    const plans = planReminders(booking, offsetsMinutes, now);
    for (const p of plans) {
      await this.jobs.enqueue(
        QUEUES.reminders,
        JOBS.reminder,
        { bookingId: booking.id, offsetMinutes: p.offsetMinutes, startAt: booking.startAt.toISOString() },
        { key: p.key, delayMs: p.fireAt.getTime() - now.getTime() },
      );
    }
    return plans;
  }
}
