import { DateTime } from 'luxon';
import { computeSlots, expandWeeklyWindows, isSlotAvailable, mergeRanges, subtractRanges, SlotQuery } from '../../src/modules/availability/slot-engine';

const MIN = 60_000;
const iso = (s: string, zone = 'Asia/Kolkata') => DateTime.fromISO(s, { zone }).toMillis();

function base(overrides: Partial<SlotQuery> = {}): SlotQuery {
  // Monday 2026-11-02, IST. Teacher works Mon 09:00-12:00.
  return {
    timezone: 'Asia/Kolkata',
    windows: [{ dayOfWeek: 1, startMinute: 9 * 60, endMinute: 12 * 60 }],
    exceptions: [],
    busy: [],
    rangeStart: iso('2026-11-02T00:00'),
    rangeEnd: iso('2026-11-03T00:00'),
    durationMinutes: 60,
    bufferMinutes: 0,
    stepMinutes: 30,
    now: iso('2026-10-30T00:00'),
    minNoticeMinutes: 0,
    maxAdvanceDays: 60,
    ...overrides,
  };
}

const starts = (q: SlotQuery) => computeSlots(q).map((s) => DateTime.fromJSDate(s.startAt).setZone(q.timezone).toFormat('HH:mm'));

describe('range helpers', () => {
  it('merges overlapping and touching ranges', () => {
    expect(mergeRanges([{ start: 5, end: 10 }, { start: 0, end: 5 }, { start: 12, end: 15 }])).toEqual([{ start: 0, end: 10 }, { start: 12, end: 15 }]);
  });
  it('subtracts ranges, splitting where needed', () => {
    expect(subtractRanges([{ start: 0, end: 100 }], [{ start: 20, end: 30 }, { start: 90, end: 120 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 90 }]);
  });
});

describe('computeSlots', () => {
  it('generates step-aligned slots that fit inside working hours', () => {
    expect(starts(base())).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('converts teacher-local hours to the correct UTC instants', () => {
    const [first] = computeSlots(base());
    expect(first.startAt.toISOString()).toBe('2026-11-02T03:30:00.000Z'); // 09:00 IST = 03:30 UTC
    expect(first.endAt.getTime() - first.startAt.getTime()).toBe(60 * MIN);
  });

  it('excludes slots overlapping an existing booking including the buffer', () => {
    // Existing 10:00-11:00 with 15 min buffer blocks until 11:15.
    const q = base({ bufferMinutes: 15, busy: [{ start: iso('2026-11-02T10:00'), end: iso('2026-11-02T11:15') }] });
    // A new 60-min slot needs [start, start+75min) free: 09:00→10:15 overlaps the booking; 11:30 would end at 12:30 (outside hours).
    expect(starts(q)).toEqual([]);
    const shorter = base({ bufferMinutes: 15, durationMinutes: 30, busy: [{ start: iso('2026-11-02T10:00'), end: iso('2026-11-02T11:15') }] });
    expect(starts(shorter)).toEqual(['09:00', '11:30']);
  });

  it('respects UNAVAILABLE exceptions and AVAILABLE extra hours', () => {
    const blocked = base({ exceptions: [{ type: 'UNAVAILABLE', start: iso('2026-11-02T09:00'), end: iso('2026-11-02T10:30') }] });
    expect(starts(blocked)).toEqual(['10:30', '11:00']);
    const extra = base({ exceptions: [{ type: 'AVAILABLE', start: iso('2026-11-02T18:00'), end: iso('2026-11-02T19:00') }] });
    expect(starts(extra)).toContain('18:00');
  });

  it('enforces minimum notice and maximum advance window', () => {
    const q = base({ now: iso('2026-11-02T08:45'), minNoticeMinutes: 90 });
    expect(starts(q)).toEqual(['10:30', '11:00']);
    expect(starts(base({ now: iso('2026-10-01T00:00'), maxAdvanceDays: 30 }))).toEqual([]);
  });

  it('handles DST transitions using wall-clock hours (America/New_York, 1 Nov 2026)', () => {
    // US DST ends Sunday 2026-11-01 at 02:00 local. A Sunday 09:00-10:00 window must start at 09:00 EST (14:00 UTC).
    const q = base({
      timezone: 'America/New_York',
      windows: [{ dayOfWeek: 7, startMinute: 9 * 60, endMinute: 10 * 60 }],
      rangeStart: iso('2026-11-01T00:00', 'America/New_York'),
      rangeEnd: iso('2026-11-02T00:00', 'America/New_York'),
    });
    const slots = computeSlots(q);
    expect(slots.map((s) => s.startAt.toISOString())).toEqual(['2026-11-01T14:00:00.000Z']);
    // The previous Sunday (EDT) maps to 13:00 UTC.
    const before = computeSlots({ ...q, now: iso('2026-10-20T00:00'), rangeStart: iso('2026-10-25T00:00', 'America/New_York'), rangeEnd: iso('2026-10-26T00:00', 'America/New_York') });
    expect(before.map((s) => s.startAt.toISOString())).toEqual(['2026-10-25T13:00:00.000Z']);
  });

  it('supports windows ending at midnight', () => {
    const q = base({ windows: [{ dayOfWeek: 1, startMinute: 22 * 60, endMinute: 1440 }] });
    expect(starts(q)).toEqual(['22:00', '22:30', '23:00']);
  });

  it('isSlotAvailable only accepts exact, free, aligned starts', () => {
    const q = base();
    expect(isSlotAvailable(q, new Date(iso('2026-11-02T09:30')))).toBe(true);
    expect(isSlotAvailable(q, new Date(iso('2026-11-02T09:10')))).toBe(false);
    expect(isSlotAvailable(q, new Date(iso('2026-11-02T11:30')))).toBe(false);
  });

  it('expandWeeklyWindows covers every matching weekday in range', () => {
    const ranges = expandWeeklyWindows([{ dayOfWeek: 1, startMinute: 600, endMinute: 660 }], 'Asia/Kolkata', iso('2026-11-02T00:00'), iso('2026-11-16T23:00'));
    expect(ranges.length).toBe(3); // 2nd, 9th, 16th
  });
});
