import { DateTime } from 'luxon';

/** Money arrives from the API as integer minor units (paise). Never use floats for arithmetic. */
export function formatMoney(minor: number | null | undefined, currency = 'INR') {
  if (minor === null || minor === undefined) return '—';
  const major = minor / 100; // display only
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

export function dt(iso: string | Date, zone: string) {
  return (typeof iso === 'string' ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso)).setZone(zone);
}

export function formatDateTime(iso: string, zone: string) {
  return dt(iso, zone).toFormat("ccc, d LLL yyyy '·' h:mm a");
}

export function formatTime(iso: string, zone: string) {
  return dt(iso, zone).toFormat('h:mm a');
}

export function formatDate(iso: string, zone: string) {
  return dt(iso, zone).toFormat('ccc, d LLL yyyy');
}

export function formatRange(startIso: string, endIso: string, zone: string) {
  const s = dt(startIso, zone);
  const e = dt(endIso, zone);
  return `${s.toFormat("ccc, d LLL '·' h:mm")}–${e.toFormat('h:mm a')} ${s.toFormat('ZZZZ')}`;
}

export function relative(iso: string) {
  return DateTime.fromISO(iso).toRelative() ?? '';
}

export function zoneLabel(zone: string) {
  return `${zone.replace(/_/g, ' ')} (${DateTime.now().setZone(zone).toFormat('ZZZZ')})`;
}

export function minutesToLabel(m: number) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return DateTime.fromObject({ hour: h % 24, minute: min }).toFormat('h:mm a');
}

export function initials(name: string) {
  return name
    .replace(/^dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

const REFUND_RULE_LABEL: Record<string, string> = {
  FULL_WINDOW: 'Full refund window',
  PARTIAL_WINDOW: 'Partial refund window',
  NO_REFUND_WINDOW: 'No refund window',
  TEACHER_CANCELLED: 'Topper cancelled',
  ADMIN_OVERRIDE: 'Admin decision',
};

/** Refund reasons are stored as `RULE: detail`; shows the rule in words. */
export function refundReasonLabel(reason: string) {
  const [rule, ...detail] = reason.split(': ');
  const label = REFUND_RULE_LABEL[rule];
  return label ? [label, ...detail].join(': ') : reason;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  PAYMENT_FAILED: 'Payment failed',
};

const HONORIFICS = /^(dr|mr|mrs|ms|mx|prof|sir|shri|smt)\.?$/i;

/** First name for greetings, skipping honorifics ("Dr. Meera Iyer" → "Meera"). */
export function firstName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  return parts.find((p) => !HONORIFICS.test(p)) ?? parts[0] ?? '';
}
