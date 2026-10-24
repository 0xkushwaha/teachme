import { DateTime, IANAZone } from 'luxon';

export function isValidTimezone(tz: string): boolean {
  return IANAZone.isValidZone(tz);
}

/** Human-friendly rendering of a UTC instant in a user's timezone, e.g. "Mon, 3 Nov 2026, 5:30 PM IST". */
export function formatInZone(date: Date, timezone: string): string {
  return DateTime.fromJSDate(date, { zone: 'utc' })
    .setZone(timezone)
    .toFormat("ccc, d LLL yyyy, h:mm a ZZZZ");
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}
