import type { Booking } from '@/types/api';

/**
 * Display-only estimate of the refund under the booking's saved policy. The server makes the
 * actual decision when the cancellation is submitted and returns the real amount.
 */
export function estimateRefund(b: Booking, actor: 'STUDENT' | 'TEACHER', now = Date.now()) {
  const paid = b.payment && ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(b.payment.status) ? b.price.totalMinor - b.payment.refundedMinor : 0;
  if (!paid) return { minor: 0, percent: 0 };
  if (actor === 'TEACHER') return { minor: paid, percent: 100 };
  const hours = (new Date(b.startAt).getTime() - now) / 3_600_000;
  const c = b.policy.cancellation;
  const percent = hours >= c.fullRefundHours ? 100 : hours >= c.partialRefundHours ? c.partialRefundPercent : 0;
  return { minor: Math.floor((paid * percent) / 100), percent };
}

export function googleCalendarLink(b: Booking) {
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${b.subject.name} with ${b.teacher.name} (TeachMe)`,
    dates: `${fmt(b.startAt)}/${fmt(b.endAt)}`,
    details: `${b.meeting?.joinUrl ? `Google Meet: ${b.meeting.joinUrl}\n` : ''}Manage this session: ${typeof window !== 'undefined' ? window.location.origin : ''}/student/sessions/${b.id}`,
    ...(b.meeting?.joinUrl ? { location: b.meeting.joinUrl } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
