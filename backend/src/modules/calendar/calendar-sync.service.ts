import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { SettingsService } from '../../services/settings.service';
import { JobQueueService } from '../../jobs/job-queue.service';
import { JOBS, jobKey, QUEUES } from '../../jobs/queues';
import { CALENDAR_GATEWAY, CalendarEventInput, CalendarEventResult, CalendarGateway, CalendarProviderError } from '../../integrations/google/calendar-gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationContextService } from '../notifications/notification-context.service';
import { AppConfig } from '../../config/app-config';
import { CalendarConnectionService } from './calendar-connection.service';

/** Deterministic Google event id (base32hex alphabet: a-v, 0-9) → inserts are idempotent. */
export function googleEventId(bookingId: string) {
  return `tm${bookingId.replace(/-/g, '')}`;
}

/** Conference request ids must be unique per creation attempt; the attempt suffix lets us retry after failure. */
export function conferenceRequestId(bookingId: string, attempt: number) {
  return `tm-${bookingId}-${attempt}`;
}

const MEET_POLL_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly connections: CalendarConnectionService,
    private readonly jobs: JobQueueService,
    private readonly notifications: NotificationsService,
    private readonly context: NotificationContextService,
    private readonly config: AppConfig,
    @Inject(CALENDAR_GATEWAY) private readonly gateway: CalendarGateway,
  ) {}

  private async load(bookingId: string) {
    return this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        subject: { select: { name: true } },
        student: { select: { email: true, fullName: true } },
        teacher: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        calendarEvent: true,
        meeting: true,
      },
    });
  }

  /** Creates or updates the teacher's calendar event (and Meet conference) for a confirmed booking. */
  async sync(bookingId: string): Promise<string> {
    const b = await this.load(bookingId);
    if (!b) return 'missing';
    if (b.status !== 'CONFIRMED') return this.cancel(bookingId);

    const flags = await this.settings.get('features.flags');
    const wantMeet = flags.meetCreation;
    if (!flags.googleCalendarSync || !this.gateway.configured) {
      await this.upsertMeeting(b.id, { status: 'NOT_CONFIGURED', lastError: 'Google Calendar integration is not enabled on this platform' });
      return 'not_configured';
    }
    const token = await this.connections.activeToken(b.teacher.user.id);
    if (!token) {
      await this.upsertMeeting(b.id, { status: 'NOT_CONFIGURED', lastError: 'Teacher has not connected Google Calendar' });
      return 'teacher_not_connected';
    }

    const meeting = wantMeet ? await this.upsertMeeting(b.id, {}) : null;
    const eventId = googleEventId(b.id);
    const ev = await this.prisma.calendarEvent.upsert({
      where: { bookingId: b.id },
      create: { bookingId: b.id, connectionId: token.connectionId, providerEventId: eventId },
      update: { connectionId: token.connectionId },
    });

    const input: CalendarEventInput = {
      eventId,
      summary: `TeachMe: ${b.subject.name} — ${b.student.fullName}`,
      description: `${b.subject.name} session with ${b.student.fullName} (${b.durationMinutes} min).\n${b.studentNote ? `Student note: ${b.studentNote}\n` : ''}Manage: ${this.config.env.APP_URL}/teacher/bookings/${b.id}`,
      startIso: b.startAt.toISOString(),
      endIso: b.endAt.toISOString(),
      timezone: b.teacherTimezone,
      attendees: [{ email: b.student.email, displayName: b.student.fullName }],
      conferenceRequestId: meeting && meeting.status !== 'READY' ? meeting.conferenceRequestId : undefined,
    };

    let result: CalendarEventResult;
    try {
      const needsInsert = ev.status === 'PENDING' || ev.status === 'DELETED' || (ev.status === 'FAILED' && !ev.syncedStartAt);
      const moved = ev.syncedStartAt?.getTime() !== b.startAt.getTime() || ev.syncedEndAt?.getTime() !== b.endAt.getTime();
      if (needsInsert) result = await this.gateway.insertEvent(token.refreshToken, input);
      else if (moved || input.conferenceRequestId) result = await this.gateway.updateEvent(token.refreshToken, input);
      else result = (await this.gateway.getEvent(token.refreshToken, eventId)) ?? (await this.gateway.insertEvent(token.refreshToken, input));
    } catch (err) {
      await this.handleError(err, ev.id, b.id, token.connectionId, b.teacher.user.id);
      throw err;
    }

    await this.prisma.calendarEvent.update({
      where: { id: ev.id },
      data: { status: 'SYNCED', syncedStartAt: b.startAt, syncedEndAt: b.endAt, lastError: null, attempts: { increment: 1 } },
    });
    await this.connections.markHealthy(token.connectionId);
    if (meeting) await this.applyMeetResult(b.id, result, 0);
    return 'synced';
  }

  /** Polls Google until an asynchronously created conference is ready. */
  async pollMeet(bookingId: string, attempt: number) {
    const b = await this.load(bookingId);
    if (!b || b.status !== 'CONFIRMED' || !b.meeting || b.meeting.status !== 'PENDING') return 'stale';
    const token = await this.connections.activeToken(b.teacher.user.id);
    if (!token) return 'teacher_not_connected';
    const ev = await this.gateway.getEvent(token.refreshToken, googleEventId(b.id));
    if (!ev) return 'event_missing';
    await this.applyMeetResult(b.id, ev, attempt);
    return 'polled';
  }

  private async applyMeetResult(bookingId: string, result: CalendarEventResult, attempt: number) {
    const meet = result.meet;
    if (meet?.status === 'success' && meet.joinUrl) {
      const updated = await this.prisma.meeting.updateMany({
        where: { bookingId, status: { not: 'READY' } },
        data: { status: 'READY', joinUrl: meet.joinUrl, conferenceId: meet.conferenceId, lastError: null, attempts: { increment: 1 } },
      });
      if (updated.count) await this.notifyMeetReady(bookingId, meet.joinUrl);
      return;
    }
    if (meet?.status === 'failure') {
      await this.prisma.meeting.update({ where: { bookingId }, data: { status: 'FAILED', lastError: 'Google could not create the Meet conference', attempts: { increment: 1 } } });
      return;
    }
    // pending (or no conference data yet): poll with bounded backoff
    if (attempt >= MEET_POLL_DELAYS_MS.length) {
      await this.prisma.meeting.update({ where: { bookingId }, data: { status: 'FAILED', lastError: 'Timed out waiting for Google Meet details' } });
      return;
    }
    await this.jobs.enqueue(
      QUEUES.integrations,
      JOBS.meetPoll,
      { bookingId, attempt: attempt + 1 },
      { key: jobKey('meet', 'poll', bookingId, attempt + 1, Date.now()), delayMs: MEET_POLL_DELAYS_MS[attempt] },
    );
  }

  private async notifyMeetReady(bookingId: string, joinUrl: string) {
    for (const recipient of ['student', 'teacher'] as const) {
      const ctx = await this.context.forBooking(bookingId, recipient);
      await this.notifications.notify({
        userId: ctx.userId,
        templateKey: 'meet_ready',
        dedupeKey: `meet_ready.${bookingId}.${joinUrl}.${ctx.userId}`,
        data: { ...ctx.data, prefsUrl: ctx.prefsUrl },
        link: ctx.link,
      });
    }
  }

  async cancel(bookingId: string): Promise<string> {
    const b = await this.load(bookingId);
    if (!b) return 'missing';
    if (b.meeting && b.meeting.status !== 'CANCELLED') {
      await this.prisma.meeting.update({ where: { bookingId }, data: { status: 'CANCELLED' } });
    }
    if (!b.calendarEvent || b.calendarEvent.status === 'DELETED' || b.calendarEvent.status === 'PENDING') return 'nothing_to_cancel';
    const token = await this.connections.activeToken(b.teacher.user.id);
    if (!token) return 'teacher_not_connected';
    try {
      await this.gateway.cancelEvent(token.refreshToken, b.calendarEvent.providerEventId);
    } catch (err) {
      await this.handleError(err, b.calendarEvent.id, b.id, token.connectionId, b.teacher.user.id);
      throw err;
    }
    await this.prisma.calendarEvent.update({ where: { id: b.calendarEvent.id }, data: { status: 'DELETED', lastError: null } });
    return 'cancelled';
  }

  /** Admin/teacher: request a fresh Meet conference after a failure. */
  async resetMeeting(bookingId: string) {
    const m = await this.prisma.meeting.findUnique({ where: { bookingId } });
    const next = (m?.attempts ?? 0) + 1;
    await this.prisma.meeting.upsert({
      where: { bookingId },
      create: { bookingId, conferenceRequestId: conferenceRequestId(bookingId, next), status: 'PENDING' },
      update: { conferenceRequestId: conferenceRequestId(bookingId, next), status: 'PENDING', lastError: null },
    });
  }

  private async upsertMeeting(bookingId: string, data: { status?: 'NOT_CONFIGURED' | 'PENDING'; lastError?: string }) {
    const existing = await this.prisma.meeting.findUnique({ where: { bookingId } });
    if (existing?.status === 'READY') return existing;
    if (existing && existing.status === 'NOT_CONFIGURED' && !data.status) {
      return this.prisma.meeting.update({ where: { bookingId }, data: { status: 'PENDING', lastError: null } });
    }
    return this.prisma.meeting.upsert({
      where: { bookingId },
      create: { bookingId, conferenceRequestId: conferenceRequestId(bookingId, 0), status: data.status ?? 'PENDING', lastError: data.lastError },
      update: { ...(data.status ? { status: data.status } : {}), ...(data.lastError !== undefined ? { lastError: data.lastError } : {}) },
    });
  }

  private async handleError(err: unknown, eventRowId: string, bookingId: string, connectionId: string, teacherUserId: string) {
    const e = err as CalendarProviderError;
    const message = e?.message ?? 'Calendar sync failed';
    await this.prisma.calendarEvent.update({ where: { id: eventRowId }, data: { status: 'FAILED', lastError: message.slice(0, 300), attempts: { increment: 1 } } });
    if (e instanceof CalendarProviderError && e.authRevoked) {
      await this.connections.markRevoked(connectionId, 'Google access was revoked or expired');
      await this.prisma.meeting.updateMany({ where: { bookingId, status: { not: 'READY' } }, data: { status: 'FAILED', lastError: 'Teacher must reconnect Google Calendar' } });
      await this.notifications.notify({
        userId: teacherUserId,
        templateKey: 'calendar_reconnect',
        dedupeKey: `calendar_reconnect.${connectionId}.${new Date().toISOString().slice(0, 10)}`,
        data: { user: { name: '' }, link: `${this.config.env.APP_URL}/teacher/integrations` },
        link: '/teacher/integrations',
      });
      throw new UnrecoverableError('Google authorization revoked');
    }
    await this.connections.markError(connectionId, message);
    if (e instanceof CalendarProviderError && !e.retryable) throw new UnrecoverableError(message);
  }
}
