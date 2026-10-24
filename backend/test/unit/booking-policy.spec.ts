import { decideRefund, rescheduleCheck } from '../../src/modules/bookings/booking-policy';

const policy = { fullRefundHours: 24, partialRefundHours: 4, partialRefundPercent: 50 };
const start = new Date('2026-11-10T10:00:00Z');
const hoursBefore = (h: number) => new Date(start.getTime() - h * 3_600_000);

describe('cancellation refunds', () => {
  it('refunds in full outside the full-refund window', () => {
    expect(decideRefund({ totalMinor: 100000, startAt: start, now: hoursBefore(30), actor: 'STUDENT', policy })).toEqual({ refundMinor: 100000, percent: 100, rule: 'FULL_WINDOW' });
  });
  it('applies the boundary inclusively', () => {
    expect(decideRefund({ totalMinor: 100000, startAt: start, now: hoursBefore(24), actor: 'STUDENT', policy }).rule).toBe('FULL_WINDOW');
  });
  it('refunds partially inside the partial window, rounding down', () => {
    expect(decideRefund({ totalMinor: 158851, startAt: start, now: hoursBefore(10), actor: 'STUDENT', policy })).toEqual({ refundMinor: 79425, percent: 50, rule: 'PARTIAL_WINDOW' });
  });
  it('gives no refund for late student cancellations', () => {
    expect(decideRefund({ totalMinor: 100000, startAt: start, now: hoursBefore(2), actor: 'STUDENT', policy }).refundMinor).toBe(0);
  });
  it('always fully refunds when the teacher cancels', () => {
    expect(decideRefund({ totalMinor: 100000, startAt: start, now: hoursBefore(1), actor: 'TEACHER', policy }).refundMinor).toBe(100000);
  });
  it('lets admins override with a clamped percentage', () => {
    expect(decideRefund({ totalMinor: 100000, startAt: start, now: hoursBefore(1), actor: 'ADMIN', policy, adminPercent: 150 }).refundMinor).toBe(100000);
    expect(decideRefund({ totalMinor: 100000, startAt: start, now: hoursBefore(1), actor: 'ADMIN', policy, adminPercent: 25 }).refundMinor).toBe(25000);
  });
});

describe('reschedule policy', () => {
  const rp = { minHoursBefore: 12, maxReschedules: 2 };
  it('allows a student reschedule with enough notice', () => {
    expect(rescheduleCheck({ startAt: start, now: hoursBefore(13), rescheduleCount: 0, policy: rp, actor: 'STUDENT' }).allowed).toBe(true);
  });
  it('blocks late student reschedules but not teacher ones', () => {
    expect(rescheduleCheck({ startAt: start, now: hoursBefore(5), rescheduleCount: 0, policy: rp, actor: 'STUDENT' }).allowed).toBe(false);
    expect(rescheduleCheck({ startAt: start, now: hoursBefore(5), rescheduleCount: 0, policy: rp, actor: 'TEACHER' }).allowed).toBe(true);
  });
  it('enforces the maximum number of reschedules', () => {
    expect(rescheduleCheck({ startAt: start, now: hoursBefore(48), rescheduleCount: 2, policy: rp, actor: 'TEACHER' }).allowed).toBe(false);
  });
  it('never allows rescheduling a session that started', () => {
    expect(rescheduleCheck({ startAt: start, now: hoursBefore(-1), rescheduleCount: 0, policy: rp, actor: 'ADMIN' }).allowed).toBe(false);
  });
});
