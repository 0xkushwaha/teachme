import { firstName } from '../utils/slug';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { OutboxEvent, Prisma } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../services/metrics.service';
import { SettingsService } from '../services/settings.service';
import type { DomainEventType } from '../services/outbox.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { NotificationContextService } from '../modules/notifications/notification-context.service';
import { ReminderSchedulerService } from '../modules/notifications/reminder-scheduler.service';
import { formatMinor } from '../utils/money';
import { formatInZone } from '../utils/time';
import { sha256 } from '../utils/crypto';
import { JobQueueService } from './job-queue.service';
import { JOBS, jobKey, QUEUES } from './queues';

const BATCH = 50;
const POLL_MS = 1000;
const MAX_ATTEMPTS = 10;

/**
 * Transactional-outbox relay. Claims pending events with FOR UPDATE SKIP LOCKED (safe across
 * replicas), performs the side effects (notifications / queue jobs, all idempotent), then marks
 * them dispatched. Failures back off exponentially; exhausted events raise an admin alert.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobQueueService,
    private readonly notifications: NotificationsService,
    private readonly context: NotificationContextService,
    private readonly reminders: ReminderSchedulerService,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
    private readonly metrics: MetricsService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.OUTBOX_AUTOSTART === 'false') return;
    this.schedule();
  }

  async onApplicationShutdown() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        let n: number;
        do n = await this.drain();
        while (n === BATCH && !this.stopped);
      } catch (err) {
        this.logger.error({ err }, 'Outbox drain failed');
      }
      this.schedule();
    }, POLL_MS);
  }

  /** Processes one batch. Public for tests. Returns number of events claimed. */
  async drain(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const events = await tx.$queryRaw<OutboxEvent[]>`
            SELECT * FROM "OutboxEvent"
             WHERE status = 'PENDING' AND "availableAt" <= now()
             ORDER BY "createdAt"
             LIMIT ${BATCH}
             FOR UPDATE SKIP LOCKED`;
          for (const e of events) {
            try {
              await this.handle(e);
              await tx.outboxEvent.update({
                where: { id: e.id },
                data: { status: 'DISPATCHED', dispatchedAt: new Date(), attempts: { increment: 1 }, payload: scrub(e.payload) },
              });
            } catch (err) {
              const attempts = e.attempts + 1;
              const final = attempts >= MAX_ATTEMPTS;
              this.logger.warn({ err, eventId: e.id, type: e.type, attempts }, 'Outbox event handling failed');
              await tx.outboxEvent.update({
                where: { id: e.id },
                data: {
                  attempts,
                  lastError: String((err as Error).message).slice(0, 500),
                  status: final ? 'FAILED' : 'PENDING',
                  availableAt: new Date(Date.now() + Math.min(2 ** attempts * 1000, 15 * 60_000)),
                },
              });
              if (final && e.type !== 'admin.alert') {
                await tx.outboxEvent.create({
                  data: { type: 'admin.alert', aggregateId: e.id, payload: { title: 'Outbox event failed permanently', detail: `${e.type} ${e.aggregateId}: ${(err as Error).message}` } },
                });
              }
            }
          }
          const pending = await tx.outboxEvent.count({ where: { status: 'PENDING' } });
          this.metrics.outboxLag.set(pending);
          return events.length;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    } finally {
      this.running = false;
    }
  }

  private async handle(e: OutboxEvent) {
    const p = e.payload as Record<string, string | number>;
    const app = this.config.env.APP_URL;
    switch (e.type as DomainEventType) {
      case 'user.registered':
      case 'user.verification_requested': {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: String(p.userId) } });
        if (user.emailVerifiedAt || p.token === '[redacted]') return;
        await this.notifications.notify({
          userId: user.id,
          templateKey: 'verify_email',
          dedupeKey: `verify_email.${sha256(String(p.token)).slice(0, 24)}`,
          data: { user: { name: firstName(user.fullName) }, link: `${app}/verify-email?token=${encodeURIComponent(String(p.token))}` },
          channels: ['EMAIL'],
        });
        return;
      }
      case 'user.password_reset_requested': {
        if (p.token === '[redacted]') return;
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: String(p.userId) } });
        await this.notifications.notify({
          userId: user.id,
          templateKey: 'password_reset',
          dedupeKey: `password_reset.${sha256(String(p.token)).slice(0, 24)}`,
          data: { user: { name: firstName(user.fullName) }, link: `${app}/reset-password?token=${encodeURIComponent(String(p.token))}` },
          channels: ['EMAIL'],
        });
        return;
      }
      case 'booking.confirmed': {
        const bookingId = String(p.bookingId);
        await this.bookingNotify(bookingId, 'student', 'booking_confirmed', `confirmed.${bookingId}`);
        await this.bookingNotify(bookingId, 'teacher', 'teacher_new_booking', `confirmed.${bookingId}`);
        await this.enqueueCalendarSync(bookingId, e.id);
        const b = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
        await this.reminders.schedule(b);
        return;
      }
      case 'booking.rescheduled': {
        const bookingId = String(p.bookingId);
        const previous = new Date(String(p.previousStartAt));
        for (const r of ['student', 'teacher'] as const) {
          const ctx = await this.context.forBooking(bookingId, r);
          const tz = r === 'student' ? ctx.booking.student.timezone : ctx.booking.teacher.user.timezone;
          await this.notifications.notify({
            userId: ctx.userId,
            templateKey: 'booking_rescheduled',
            dedupeKey: `rescheduled.${e.id}.${ctx.userId}`,
            data: { ...ctx.data, prefsUrl: ctx.prefsUrl, previous: { time: formatInZone(previous, tz) } },
            link: ctx.link,
          });
        }
        await this.enqueueCalendarSync(bookingId, e.id);
        const b = await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
        await this.reminders.schedule(b);
        return;
      }
      case 'booking.cancelled': {
        const bookingId = String(p.bookingId);
        const actor = String(p.actor);
        const refundMinor = Number(p.refundMinor);
        for (const r of ['student', 'teacher'] as const) {
          const ctx = await this.context.forBooking(bookingId, r);
          const by = actor === 'STUDENT' ? (r === 'student' ? 'you' : 'the student') : actor === 'TEACHER' ? (r === 'teacher' ? 'you' : 'your teacher') : 'TeachMe support';
          await this.notifications.notify({
            userId: ctx.userId,
            templateKey: 'booking_cancelled',
            dedupeKey: `cancelled.${bookingId}.${ctx.userId}`,
            data: {
              ...ctx.data,
              prefsUrl: ctx.prefsUrl,
              cancel: { by, reason: ctx.booking.cancellationReason ?? '' },
              refund: { text: r === 'student' ? (refundMinor > 0 ? `A refund of ${formatMinor(refundMinor, ctx.booking.currency)} has been initiated to your original payment method.` : 'This cancellation is not eligible for a refund under the cancellation policy.') : '' },
            },
            link: ctx.link,
          });
        }
        await this.jobs.enqueue(QUEUES.integrations, JOBS.calendarCancel, { bookingId }, { key: jobKey('calendar', 'cancel', bookingId), track: true, entityType: 'Booking', entityId: bookingId });
        return;
      }
      case 'payment.failed': {
        const bookingId = String(p.bookingId);
        const ctx = await this.context.forBooking(bookingId, 'student');
        await this.notifications.notify({
          userId: ctx.userId,
          templateKey: 'payment_failed',
          dedupeKey: `payment_failed.${e.aggregateId}`,
          data: { ...ctx.data, prefsUrl: ctx.prefsUrl, payment: { ...ctx.data.payment, reason: String(p.reason ?? '') } },
          link: `/student/checkout/${bookingId}`,
        });
        return;
      }
      case 'payment.conflict': {
        const bookingId = String(p.bookingId);
        const ctx = await this.context.forBooking(bookingId, 'student');
        await this.notifications.notify({ userId: ctx.userId, templateKey: 'payment_conflict', dedupeKey: `payment_conflict.${p.paymentId}`, data: { ...ctx.data, prefsUrl: ctx.prefsUrl }, link: ctx.link });
        await this.adminAlert('Paid booking could not be confirmed', `Booking ${bookingId} (payment ${p.paymentId}) was paid after the slot became unavailable. A full refund was queued.`, `conflict.${p.paymentId}`);
        return;
      }
      case 'refund.requested': {
        const refundId = String(p.refundId);
        await this.jobs.enqueue(QUEUES.payments, JOBS.refundProcess, { refundId }, { key: jobKey('refund', refundId), track: true, entityType: 'Refund', entityId: refundId });
        return;
      }
      case 'refund.updated': {
        const refund = await this.prisma.refund.findUniqueOrThrow({ where: { id: String(p.refundId) } });
        if (refund.status === 'PENDING') return;
        const ctx = await this.context.forBooking(refund.bookingId, 'student');
        const status = refund.status === 'PROCESSED' ? 'processed' : refund.status === 'FAILED' ? 'delayed' : 'initiated';
        await this.notifications.notify({
          userId: ctx.userId,
          templateKey: 'refund_update',
          dedupeKey: `refund.${refund.id}.${refund.status}`,
          data: {
            ...ctx.data,
            prefsUrl: ctx.prefsUrl,
            refund: {
              amount: formatMinor(refund.amountMinor, ctx.booking.currency),
              status,
              note: refund.status === 'PROCESSED' ? 'Refunds usually reach your account within 5-7 working days, depending on your bank.' : refund.status === 'FAILED' ? 'Our team has been alerted and will resolve this. No action is needed from you.' : "We'll let you know when your bank confirms it.",
            },
          },
          link: ctx.link,
        });
        return;
      }
      case 'teacher.approval_changed': {
        const t = await this.prisma.teacherProfile.findUniqueOrThrow({ where: { id: String(p.teacherId) }, include: { user: true } });
        const status = String(p.status);
        const message = {
          APPROVED: 'Your profile has been approved. Students can now discover you and book sessions in your available hours.',
          REJECTED: 'Your application was not approved at this time. Reply to this email or contact support for details.',
          SUSPENDED: 'Your profile has been suspended and is hidden from students. Contact support for details.',
          PENDING: 'Your profile is under review again.',
        }[status] ?? 'Your profile status changed.';
        await this.notifications.notify({
          userId: t.userId,
          templateKey: 'teacher_approval',
          dedupeKey: `approval.${e.id}`,
          data: { user: { name: firstName(t.user.fullName) }, approval: { status: status.toLowerCase(), message }, dashboard: { url: `${app}/teacher` } },
          link: '/teacher',
        });
        return;
      }
      case 'admin.alert':
        await this.adminAlert(String(p.title), String(p.detail), `alert.${e.id}`);
        return;
      default:
        this.logger.warn({ type: e.type }, 'Unhandled outbox event type');
    }
  }

  private async bookingNotify(bookingId: string, recipient: 'student' | 'teacher', templateKey: string, dedupeBase: string) {
    const ctx = await this.context.forBooking(bookingId, recipient);
    await this.notifications.notify({ userId: ctx.userId, templateKey, dedupeKey: `${dedupeBase}.${ctx.userId}`, data: { ...ctx.data, prefsUrl: ctx.prefsUrl }, link: ctx.link });
  }

  private async enqueueCalendarSync(bookingId: string, eventId: string) {
    await this.jobs.enqueue(QUEUES.integrations, JOBS.calendarSync, { bookingId }, {
      key: jobKey('calendar', 'sync', bookingId, eventId),
      track: true,
      entityType: 'Booking',
      entityId: bookingId,
    });
  }

  private async adminAlert(title: string, detail: string, key: string) {
    const { adminAlertEmail } = await this.settings.get('notifications.reminders');
    await this.notifications.notifyAdmins(title, detail, key, adminAlertEmail, `${this.config.env.APP_URL}/admin/integrations`);
  }
}

/** One-time tokens are not kept in the outbox after dispatch. */
function scrub(payload: Prisma.JsonValue): Prisma.InputJsonValue {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'token' in payload) {
    return { ...(payload as Record<string, unknown>), token: '[redacted]' } as Prisma.InputJsonValue;
  }
  return payload as Prisma.InputJsonValue;
}
