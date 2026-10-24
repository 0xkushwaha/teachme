import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../services/redis.service';
import { DEFAULT_JOB_OPTIONS, QUEUES, QueueName } from './queues';

export interface EnqueueOptions {
  key: string;
  delayMs?: number;
  entityType?: string;
  entityId?: string;
  /** Track in JobRecord for the operations dashboard (integration work). */
  track?: boolean;
  opts?: JobsOptions;
}

/** Producer side of all queues. Safe to call from API and worker processes. */
@Injectable()
export class JobQueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly connection;

  constructor(
    config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    this.connection = RedisService.bullConnection(config.env.REDIS_URL);
    for (const name of Object.values(QUEUES)) {
      this.queues.set(name, new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS[name] }));
    }
  }

  queue(name: QueueName): Queue {
    return this.queues.get(name)!;
  }

  allQueues() {
    return [...this.queues.values()];
  }

  /** Idempotent enqueue: BullMQ ignores a second add with the same jobId while the first exists. */
  async enqueue(queue: QueueName, name: string, data: Record<string, unknown>, o: EnqueueOptions) {
    if (o.track) {
      await this.prisma.jobRecord.upsert({
        where: { jobKey: o.key },
        create: {
          queue,
          name,
          jobKey: o.key,
          entityType: o.entityType,
          entityId: o.entityId,
          payload: data as Prisma.InputJsonValue,
        },
        update: {},
      });
    }
    await this.queue(queue).add(name, data, { ...o.opts, jobId: o.key, delay: o.delayMs && o.delayMs > 0 ? o.delayMs : undefined });
  }

  /** Re-run a failed job (admin action). */
  async retry(queue: QueueName, key: string, name: string, data: Record<string, unknown>) {
    const job = await this.queue(queue).getJob(key);
    if (job) {
      const state = await job.getState();
      if (state === 'failed') {
        await job.retry();
        return 'retried';
      }
      if (state === 'completed') await job.remove();
      else return state;
    }
    await this.queue(queue).add(name, data, { jobId: key });
    return 'enqueued';
  }

  async onModuleDestroy() {
    await Promise.all(this.allQueues().map((q) => q.close()));
    await this.connection.quit().catch(() => undefined);
  }
}
