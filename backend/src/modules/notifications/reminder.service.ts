import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SettingsService } from '../../services/settings.service';
import { NotificationContextService } from './notification-context.service';
import { NotificationsService } from './notifications.service';
import { describeOffset } from './reminder-scheduler.service';

/** Sends reminders (worker side) and repairs missed ones after outages. */
@Injectable()
export class ReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly context: NotificationContextService,
    private readonly settings: SettingsService,
  ) {}

  /** Returns false when the reminder is stale (booking cancelled or moved). */
  async send(bookingId: string, offsetMinutes: number, startAtIso: string): Promise<boolean> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true, startAt: true } });
    if (!booking || booking.status !== 'CONFIRMED') return false;
    if (booking.startAt.toISOString() !== startAtIso) return false;
    if (booking.startAt.getTime() <= Date.now()) return false;

    for (const recipient of ['student', 'teacher'] as const) {
      const ctx = await this.context.forBooking(bookingId, recipient);
      await this.notifications.notify({
        userId: ctx.userId,
        templateKey: 'session_reminder',
        dedupeKey: `reminder.${bookingId}.${offsetMinutes}.${booking.startAt.getTime()}.${ctx.userId}`,
        data: { ...ctx.data, prefsUrl: ctx.prefsUrl, reminder: { when: describeOffset(offsetMinutes) } },
        link: ctx.link,
      });
    }
    return true;
  }

  /**
   * Safety net for lost/late delayed jobs: for every confirmed upcoming session, send any reminder
   * whose fire time has passed but that was never recorded. Dedupe keys make this idempotent.
   */
  async sweep(now = new Date()) {
    const { offsetsMinutes } = await this.settings.get('notifications.reminders');
    if (!offsetsMinutes.length) return 0;
    const maxOffset = Math.max(...offsetsMinutes);
    const bookings = await this.prisma.booking.findMany({
      where: { status: 'CONFIRMED', startAt: { gt: now, lte: new Date(now.getTime() + maxOffset * 60_000) } },
      select: { id: true, startAt: true, confirmedAt: true, updatedAt: true, studentId: true },
      take: 500,
    });
    let sent = 0;
    for (const b of bookings) {
      for (const offset of offsetsMinutes) {
        const fireAt = b.startAt.getTime() - offset * 60_000;
        const since = (b.confirmedAt ?? b.updatedAt).getTime();
        if (fireAt > now.getTime() || fireAt < since) continue;
        const key = `reminder.${b.id}.${offset}.${b.startAt.getTime()}.${b.studentId}.IN_APP`;
        const exists = await this.prisma.notification.findUnique({ where: { dedupeKey: key }, select: { id: true } });
        if (exists) continue;
        if (await this.send(b.id, offset, b.startAt.toISOString())) sent++;
      }
    }
    return sent;
  }
}
