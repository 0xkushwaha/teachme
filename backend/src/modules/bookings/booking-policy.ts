/**
 * Cancellation / reschedule rules. Pure functions over a policy snapshot that is copied onto
 * each booking at creation time, so later admin policy changes don't retroactively apply.
 */

export interface CancellationPolicy {
  /** Cancel at least this many hours before start → full refund. */
  fullRefundHours: number;
  /** Cancel at least this many hours before start → partialRefundPercent refund. */
  partialRefundHours: number;
  partialRefundPercent: number;
}

export interface ReschedulePolicy {
  minHoursBefore: number;
  maxReschedules: number;
}

export interface PolicySnapshot {
  cancellation: CancellationPolicy;
  reschedule: ReschedulePolicy;
}

export type CancelActor = 'STUDENT' | 'TEACHER' | 'ADMIN';

export interface RefundDecision {
  refundMinor: number;
  percent: number;
  rule: 'FULL_WINDOW' | 'PARTIAL_WINDOW' | 'NO_REFUND_WINDOW' | 'TEACHER_CANCELLED' | 'ADMIN_OVERRIDE';
}

const HOUR = 3_600_000;

export function decideRefund(params: {
  totalMinor: number;
  startAt: Date;
  now: Date;
  actor: CancelActor;
  policy: CancellationPolicy;
  adminPercent?: number;
}): RefundDecision {
  const { totalMinor, startAt, now, actor, policy } = params;
  if (actor === 'TEACHER') return { refundMinor: totalMinor, percent: 100, rule: 'TEACHER_CANCELLED' };
  if (actor === 'ADMIN' && params.adminPercent !== undefined) {
    const pct = Math.min(100, Math.max(0, Math.trunc(params.adminPercent)));
    return { refundMinor: Math.floor((totalMinor * pct) / 100), percent: pct, rule: 'ADMIN_OVERRIDE' };
  }
  const hoursBefore = (startAt.getTime() - now.getTime()) / HOUR;
  if (hoursBefore >= policy.fullRefundHours) return { refundMinor: totalMinor, percent: 100, rule: 'FULL_WINDOW' };
  if (hoursBefore >= policy.partialRefundHours) {
    const pct = policy.partialRefundPercent;
    return { refundMinor: Math.floor((totalMinor * pct) / 100), percent: pct, rule: 'PARTIAL_WINDOW' };
  }
  return { refundMinor: 0, percent: 0, rule: 'NO_REFUND_WINDOW' };
}

export function canCancel(startAt: Date, now: Date): boolean {
  return startAt.getTime() > now.getTime();
}

export function rescheduleCheck(params: {
  startAt: Date;
  now: Date;
  rescheduleCount: number;
  policy: ReschedulePolicy;
  actor: CancelActor;
}): { allowed: true } | { allowed: false; reason: string } {
  const { startAt, now, rescheduleCount, policy, actor } = params;
  if (startAt.getTime() <= now.getTime()) return { allowed: false, reason: 'Session has already started' };
  if (actor === 'ADMIN') return { allowed: true };
  if (rescheduleCount >= policy.maxReschedules)
    return { allowed: false, reason: `A booking can be rescheduled at most ${policy.maxReschedules} times` };
  const hoursBefore = (startAt.getTime() - now.getTime()) / HOUR;
  if (actor === 'STUDENT' && hoursBefore < policy.minHoursBefore)
    return { allowed: false, reason: `Reschedules must be made at least ${policy.minHoursBefore} hours before the session` };
  return { allowed: true };
}
