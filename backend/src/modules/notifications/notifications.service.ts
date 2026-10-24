import { Injectable, Logger } from '@nestjs/common';
import { DeliveryStatus, NotificationCategory, NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { isUniqueViolation } from '../../database/prisma-errors';
import { JobQueueService } from '../../jobs/job-queue.service';
import { JOBS, jobKey, QUEUES } from '../../jobs/queues';
import { render } from './template-renderer';
import { TEMPLATE_BY_KEY } from './templates/defaults';

export interface NotifyInput {
  userId: string;
  templateKey: string;
  /** Stable key for this logical message; per-channel suffix is appended. Retries never duplicate. */
  dedupeKey: string;
  data: Record<string, unknown>;
  channels?: NotificationChannel[];
  link?: string;
}

const CONFIGURABLE: NotificationCategory[] = ['BOOKING', 'REMINDER', 'PAYMENT', 'MARKETING'];

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobQueueService,
  ) {}

  async notify(input: NotifyInput) {
    const def = TEMPLATE_BY_KEY.get(input.templateKey);
    if (!def) throw new Error(`Unknown notification template ${input.templateKey}`);
    const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { status: true } });
    if (!user || user.status === 'DELETED') return;

    const channels = input.channels ?? ['IN_APP', 'EMAIL'];
    const prefs = await this.prisma.notificationPreference.findMany({ where: { userId: input.userId, category: def.category } });
    const enabled = (ch: NotificationChannel) => {
      if (def.mandatory && ch === 'EMAIL') return true;
      if (!CONFIGURABLE.includes(def.category)) return true;
      const p = prefs.find((x) => x.channel === ch);
      return p ? p.enabled : def.category !== 'MARKETING';
    };

    const title = render(def.subject, input.data, false);
    const body = render(def.inApp, input.data, false);

    for (const channel of channels) {
      if (channel !== 'IN_APP' && channel !== 'EMAIL') continue; // SMS/WhatsApp: adapters not enabled yet
      const isEmail = channel === 'EMAIL';
      const skipped = !enabled(channel);
      const dedupeKey = `${input.dedupeKey}.${channel}`;
      let notificationId: string;
      try {
        const created = await this.prisma.notification.create({
          data: {
            userId: input.userId,
            type: input.templateKey,
            category: def.category,
            channel,
            title,
            body,
            dedupeKey,
            data: { link: input.link ?? null, ...(isEmail ? { context: input.data } : {}) } as Prisma.InputJsonValue,
            status: skipped ? DeliveryStatus.SKIPPED : isEmail ? DeliveryStatus.PENDING : DeliveryStatus.SENT,
            sentAt: !isEmail && !skipped ? new Date() : null,
          },
        });
        notificationId = created.id;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const existing = await this.prisma.notification.findUnique({ where: { dedupeKey } });
        if (!existing || existing.status === 'SENT' || existing.status === 'SKIPPED' || !isEmail) continue;
        notificationId = existing.id;
      }
      if (isEmail && !skipped) {
        await this.jobs.enqueue(QUEUES.notifications, JOBS.sendEmail, { notificationId }, {
          key: jobKey('email', notificationId),
          track: true,
          entityType: 'Notification',
          entityId: notificationId,
        });
      }
    }
  }

  async notifyAdmins(title: string, detail: string, dedupeKey: string, adminAlertEmail: string | null, adminUrl: string) {
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, email: true } });
    for (const a of admins) {
      const emailThisAdmin = !adminAlertEmail || adminAlertEmail === a.email;
      await this.notify({
        userId: a.id,
        templateKey: 'admin_alert',
        dedupeKey: `${dedupeKey}.${a.id}`,
        data: { alert: { title, detail }, admin: { url: adminUrl } },
        channels: emailThisAdmin ? ['IN_APP', 'EMAIL'] : ['IN_APP'],
        link: '/admin/integrations',
      });
    }
    if (!admins.length) this.logger.error({ title, detail }, 'Admin alert raised but no active admins exist');
  }

  list(userId: string, opts: { unreadOnly: boolean; skip: number; take: number }) {
    const where: Prisma.NotificationWhereInput = { userId, channel: 'IN_APP', ...(opts.unreadOnly ? { readAt: null } : {}) };
    return this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: opts.skip,
        take: opts.take,
        select: { id: true, type: true, category: true, title: true, body: true, data: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where }),
    ]);
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, channel: 'IN_APP', readAt: null } });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId, channel: 'IN_APP', readAt: null }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, channel: 'IN_APP', readAt: null }, data: { readAt: new Date() } });
  }

  async getPreferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const out: { channel: NotificationChannel; category: NotificationCategory; enabled: boolean }[] = [];
    for (const category of CONFIGURABLE) {
      for (const channel of ['EMAIL', 'IN_APP'] as NotificationChannel[]) {
        const row = rows.find((r) => r.category === category && r.channel === channel);
        out.push({ channel, category, enabled: row ? row.enabled : category !== 'MARKETING' });
      }
    }
    return out;
  }

  async setPreferences(userId: string, prefs: { channel: NotificationChannel; category: NotificationCategory; enabled: boolean }[]) {
    const valid = prefs.filter((p) => CONFIGURABLE.includes(p.category));
    await this.prisma.$transaction(
      valid.map((p) =>
        this.prisma.notificationPreference.upsert({
          where: { userId_channel_category: { userId, channel: p.channel, category: p.category } },
          create: { userId, ...p },
          update: { enabled: p.enabled },
        }),
      ),
    );
    return this.getPreferences(userId);
  }
}
