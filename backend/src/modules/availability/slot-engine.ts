import { DateTime } from 'luxon';

/**
 * Pure availability engine. Given a teacher's weekly rules (local time), absolute exceptions,
 * and the ranges already blocked by bookings, it returns bookable UTC slots.
 *
 * The same function is used to render the calendar and to validate a booking request on the
 * server; the database exclusion constraint is the final authority on overlaps.
 */

export interface WeeklyWindow {
  dayOfWeek: number; // ISO 1..7
  startMinute: number;
  endMinute: number;
}

export interface TimeRange {
  start: number; // epoch ms (UTC)
  end: number; // epoch ms, exclusive
}

export interface AvailabilityException extends TimeRange {
  type: 'AVAILABLE' | 'UNAVAILABLE';
}

export interface SlotQuery {
  timezone: string;
  windows: WeeklyWindow[];
  exceptions: AvailabilityException[];
  /** Ranges held by existing bookings: [startAt, blockedUntil). */
  busy: TimeRange[];
  rangeStart: number;
  rangeEnd: number;
  durationMinutes: number;
  bufferMinutes: number;
  stepMinutes: number;
  now: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}

export interface Slot {
  startAt: Date;
  endAt: Date;
}

const MIN = 60_000;

export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function subtractRanges(base: TimeRange[], remove: TimeRange[]): TimeRange[] {
  let result = mergeRanges(base);
  for (const cut of mergeRanges(remove)) {
    const next: TimeRange[] = [];
    for (const r of result) {
      if (cut.end <= r.start || cut.start >= r.end) {
        next.push(r);
        continue;
      }
      if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
      if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
    }
    result = next;
  }
  return result;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Expand weekly windows into absolute UTC ranges covering [from, to] in the teacher's zone. */
export function expandWeeklyWindows(windows: WeeklyWindow[], timezone: string, from: number, to: number): TimeRange[] {
  const out: TimeRange[] = [];
  let day = DateTime.fromMillis(from, { zone: timezone }).startOf('day').minus({ days: 1 });
  const last = DateTime.fromMillis(to, { zone: timezone }).startOf('day').plus({ days: 1 });
  while (day <= last) {
    for (const w of windows) {
      if (w.dayOfWeek !== day.weekday) continue;
      const start = atLocalMinute(day, w.startMinute);
      const end = atLocalMinute(day, w.endMinute);
      if (end > start) out.push({ start, end });
    }
    day = day.plus({ days: 1 });
  }
  return mergeRanges(out);
}

function atLocalMinute(dayStart: DateTime, minute: number): number {
  if (minute >= 1440) return dayStart.plus({ days: 1 }).toMillis();
  // `set` keeps wall-clock semantics across DST transitions.
  return dayStart.set({ hour: Math.floor(minute / 60), minute: minute % 60 }).toMillis();
}

export function computeSlots(q: SlotQuery): Slot[] {
  if (q.durationMinutes <= 0 || q.stepMinutes <= 0) return [];
  const earliest = Math.max(q.rangeStart, q.now + q.minNoticeMinutes * MIN);
  const latest = Math.min(q.rangeEnd, q.now + q.maxAdvanceDays * 24 * 60 * MIN);
  if (latest <= earliest) return [];

  const weekly = expandWeeklyWindows(q.windows, q.timezone, q.rangeStart, q.rangeEnd);
  const extra = q.exceptions.filter((e) => e.type === 'AVAILABLE');
  const blocked = q.exceptions.filter((e) => e.type === 'UNAVAILABLE');
  const free = subtractRanges([...weekly, ...extra], blocked);

  const durMs = q.durationMinutes * MIN;
  const holdMs = (q.durationMinutes + q.bufferMinutes) * MIN;
  const stepMs = q.stepMinutes * MIN;
  const busy = mergeRanges(q.busy);
  const slots: Slot[] = [];
  const seen = new Set<number>();

  for (const range of free) {
    // Align to the step grid on the teacher's local clock (e.g. :00 / :30).
    const local = DateTime.fromMillis(range.start, { zone: q.timezone });
    const minuteOfDay = local.hour * 60 + local.minute + local.second / 60 + local.millisecond / 60000;
    const offset = (q.stepMinutes - (minuteOfDay % q.stepMinutes)) % q.stepMinutes;
    let start = range.start + Math.round(offset * MIN);

    for (; start + durMs <= range.end; start += stepMs) {
      if (start < earliest || start > latest) continue;
      const hold = { start, end: start + holdMs };
      if (busy.some((b) => overlaps(hold, b))) continue;
      // A new booking must also not run into an existing booking that starts during our buffer:
      // the existing booking's range [b.start, b.blockedUntil) is compared against [start, start+dur+buffer).
      if (seen.has(start)) continue;
      seen.add(start);
      slots.push({ startAt: new Date(start), endAt: new Date(start + durMs) });
    }
  }
  return slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

export function isSlotAvailable(q: Omit<SlotQuery, 'rangeStart' | 'rangeEnd'>, startAt: Date): boolean {
  const t = startAt.getTime();
  const slots = computeSlots({ ...q, rangeStart: t - 24 * 60 * MIN, rangeEnd: t + 24 * 60 * MIN });
  return slots.some((s) => s.startAt.getTime() === t);
}
