import { JobsOptions } from 'bullmq';

export const QUEUES = {
  notifications: 'notifications',
  integrations: 'integrations',
  payments: 'payments',
  reminders: 'reminders',
  maintenance: 'maintenance',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  sendEmail: 'email.send',
  calendarSync: 'calendar.sync',
  calendarCancel: 'calendar.cancel',
  meetPoll: 'meet.poll',
  refundProcess: 'refund.process',
  reminder: 'reminder.send',
  expireHolds: 'maintenance.expire-holds',
  completeSessions: 'maintenance.complete-sessions',
  reconcilePayments: 'maintenance.reconcile-payments',
  reminderSweep: 'maintenance.reminder-sweep',
  retention: 'maintenance.retention',
  queueMetrics: 'maintenance.queue-metrics',
} as const;

/** Retry policy per queue: bounded attempts with exponential backoff. */
export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  notifications: { attempts: 6, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  integrations: { attempts: 8, backoff: { type: 'exponential', delay: 20_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  payments: { attempts: 10, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  reminders: { attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  maintenance: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100, removeOnFail: 500 },
};

/** BullMQ forbids ':' in custom job ids. */
export function jobKey(...parts: (string | number)[]) {
  return parts.map((p) => String(p).replace(/:/g, '_')).join('.');
}
