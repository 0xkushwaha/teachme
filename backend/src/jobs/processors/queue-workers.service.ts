import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import type Redis from 'ioredis';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { MetricsService } from '../../services/metrics.service';
import { RedisService } from '../../services/redis.service';
import { BookingsService } from '../../modules/bookings/bookings.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { CalendarSyncService } from '../../modules/calendar/calendar-sync.service';
import { EmailSenderService } from '../../modules/notifications/email-sender.service';
import { ReminderService } from '../../modules/notifications/reminder.service';
import { PaymentProviderError } from '../../integrations/razorpay/payment-gateway';
import { JobQueueService } from '../job-queue.service';
import { JobRecordService } from '../job-record.service';
import { DEFAULT_JOB_OPTIONS, JOBS, QUEUES, QueueName } from '../queues';

const CONCURRENCY: Record<QueueName, number> = { notifications: 10, integrations: 5, payments: 3, reminders: 10, maintenance: 1 };

/** Consumer side: one BullMQ worker per queue. Runs in `worker.ts` (or the API when RUN_WORKERS_IN_API=true). */
@Injectable()
export class QueueWorkersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueWorkersService.name);
  private workers: Worker[] = [];
  private connections: Redis[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly records: JobRecordService,
    private readonly metrics: MetricsService,
    private readonly jobs: JobQueueService,
    private readonly email: EmailSenderService,
    private readonly reminders: ReminderService,
    private readonly calendar: CalendarSyncService,
    private readonly payments: PaymentsService,
    private readonly bookings: BookingsService,
  ) {}

  async onApplicationBootstrap() {
    for (const queue of Object.values(QUEUES)) {
      const connection = RedisService.bullConnection(this.config.env.REDIS_URL);
      this.connections.push(connection);
      const worker = new Worker(queue, (job) => this.run(queue, job), { connection, concurrency: CONCURRENCY[queue] });
      worker.on('failed', (job, err) => this.onFailed(queue, job, err));
      worker.on('error', (err) => this.logger.error({ err, queue }, 'Worker error'));
      this.workers.push(worker);
    }
    await this.registerSchedules();
    this.logger.log(`Queue workers started: ${Object.values(QUEUES).join(', ')}`);
  }

  /** Graceful shutdown: stop taking jobs and let active ones finish. */
  async onApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  private async registerSchedules() {
    const m = this.jobs.queue(QUEUES.maintenance);
    const every = (id: string, ms: number) => m.upsertJobScheduler(id, { every: ms }, { name: id, data: {} });
    await every(JOBS.expireHolds, 60_000);
    await every(JOBS.completeSessions, 5 * 60_000);
    await every(JOBS.reconcilePayments, 10 * 60_000);
    await every(JOBS.reminderSweep, 5 * 60_000);
    await every(JOBS.queueMetrics, 30_000);
    await every(JOBS.retention, 24 * 3_600_000);
  }

  private async run(queue: QueueName, job: Job) {
    const key = job.id ?? '';
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? DEFAULT_JOB_OPTIONS[queue].attempts ?? 1;
    await this.records.started(key, attempt);
    const result = await this.dispatch(job, attempt, attempt >= maxAttempts);
    await this.records.succeeded(key, typeof result === 'string' && result !== 'synced' && result !== 'sent' ? result : undefined);
    this.metrics.jobEvents.inc({ queue, outcome: 'completed' });
    return result;
  }

  private async dispatch(job: Job, attempt: number, finalAttempt: boolean): Promise<unknown> {
    const d = job.data as Record<string, string & number>;
    switch (job.name) {
      case JOBS.sendEmail:
        return this.email.send(d.notificationId, attempt, finalAttempt);
      case JOBS.reminder:
        return (await this.reminders.send(d.bookingId, Number(d.offsetMinutes), d.startAt)) ? 'sent' : 'stale';
      case JOBS.calendarSync:
        return this.calendar.sync(d.bookingId);
      case JOBS.calendarCancel:
        return this.calendar.cancel(d.bookingId);
      case JOBS.meetPoll:
        return this.calendar.pollMeet(d.bookingId, Number(d.attempt));
      case JOBS.refundProcess:
        try {
          return await this.payments.processRefund(d.refundId);
        } catch (err) {
          if (err instanceof PaymentProviderError && !err.retryable) {
            await this.payments.markRefundFailed(d.refundId, err.message);
            throw new UnrecoverableError(err.message);
          }
          if (finalAttempt) await this.payments.markRefundFailed(d.refundId, (err as Error).message);
          throw err;
        }
      case JOBS.expireHolds:
        return this.prisma.$transaction((tx) => this.bookings.expireStaleHolds(tx));
      case JOBS.completeSessions:
        return this.bookings.completeFinished();
      case JOBS.reconcilePayments:
        return this.payments.reconcile();
      case JOBS.reminderSweep:
        return this.reminders.sweep();
      case JOBS.queueMetrics:
        for (const q of this.jobs.allQueues()) this.metrics.queueWaiting.set({ queue: q.name }, await q.getWaitingCount());
        return 'ok';
      case JOBS.retention:
        return this.retention();
      default:
        throw new UnrecoverableError(`Unknown job ${job.name}`);
    }
  }

  /** Data-retention policy (docs/security.md#retention). */
  private async retention() {
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    const [idem, sessions, tokens, outbox, notifications, webhooks, jobs] = await this.prisma.$transaction([
      this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: days(1) } }, { revokedAt: { lt: days(30) } }] } }),
      this.prisma.verificationToken.deleteMany({ where: { OR: [{ usedAt: { lt: days(30) } }, { expiresAt: { lt: days(30) } }] } }),
      this.prisma.outboxEvent.deleteMany({ where: { status: 'DISPATCHED', dispatchedAt: { lt: days(14) } } }),
      this.prisma.notification.deleteMany({ where: { createdAt: { lt: days(365) } } }),
      this.prisma.webhookEvent.deleteMany({ where: { processedAt: { lt: days(180) } } }),
      this.prisma.jobRecord.deleteMany({ where: { status: 'SUCCEEDED', updatedAt: { lt: days(30) } } }),
    ]);
    return { idem: idem.count, sessions: sessions.count, tokens: tokens.count, outbox: outbox.count, notifications: notifications.count, webhooks: webhooks.count, jobs: jobs.count };
  }

  private async onFailed(queue: QueueName, job: Job | undefined, err: Error) {
    if (!job) return;
    const max = job.opts.attempts ?? 1;
    const final = err instanceof UnrecoverableError || job.attemptsMade >= max;
    this.metrics.jobEvents.inc({ queue, outcome: final ? 'dead' : 'retry' });
    await this.records.failed(job.id ?? '', err.message, final).catch(() => undefined);
    this.logger.warn({ queue, job: job.name, id: job.id, attempt: job.attemptsMade, final, err: err.message }, 'Job failed');
  }
}
