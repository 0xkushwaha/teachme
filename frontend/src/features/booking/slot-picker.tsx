'use client';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DateTime } from 'luxon';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { ErrorState, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { catalogService } from '@/services/catalog';
import type { Slot } from '@/types/api';
import { cn } from '@/utils/cn';

/**
 * Week view of bookable slots, rendered in the viewer's timezone. Slots are fetched live
 * (never cached long) because availability changes as others book.
 */
export function SlotPicker({ teacherId, durationMinutes, timezone, selected, onSelect, excludeStart, maxAdvanceDays = 60 }: {
  teacherId: string;
  durationMinutes: number;
  timezone: string;
  selected: string | null;
  onSelect: (slot: Slot) => void;
  excludeStart?: string;
  maxAdvanceDays?: number;
}) {
  const today = DateTime.now().setZone(timezone).startOf('day');
  const [offset, setOffset] = useState(0);
  const weekStart = today.plus({ weeks: offset });
  const weekEnd = weekStart.plus({ days: 7 });
  const [day, setDay] = useState(0);

  const slots = useQuery({
    queryKey: ['slots', teacherId, durationMinutes, weekStart.toISODate()],
    queryFn: () => catalogService.slots(teacherId, weekStart.toUTC().toISO()!, weekEnd.toUTC().toISO()!, durationMinutes),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const byDay = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => ({ date: weekStart.plus({ days: i }), slots: [] as Slot[] }));
    for (const s of slots.data?.slots ?? []) {
      if (s.startAt === excludeStart) continue;
      const local = DateTime.fromISO(s.startAt).setZone(timezone);
      const idx = Math.floor(local.startOf('day').diff(weekStart, 'days').days);
      days[idx]?.slots.push(s);
    }
    return days;
  }, [slots.data, weekStart, timezone, excludeStart]);

  const canNext = weekEnd < today.plus({ days: maxAdvanceDays });
  const total = byDay.reduce((a, d) => a + d.slots.length, 0);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium" aria-live="polite">
          {weekStart.toFormat('d LLL')} – {weekEnd.minus({ days: 1 }).toFormat('d LLL yyyy')}
        </p>
        <div className="flex gap-1">
          <button type="button" onClick={() => { setOffset((o) => o - 1); setDay(0); }} disabled={offset === 0} className="grid size-8 place-items-center rounded-lg border border-border hover:bg-muted disabled:opacity-40" aria-label="Previous week">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => { setOffset((o) => o + 1); setDay(0); }} disabled={!canNext} className="grid size-8 place-items-center rounded-lg border border-border hover:bg-muted disabled:opacity-40" aria-label="Next week">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Day" className="grid grid-cols-7 gap-1">
        {byDay.map((d, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={day === i}
            aria-label={`${d.date.toFormat('cccc d LLLL')}, ${slots.isLoading ? 'loading' : d.slots.length ? `${d.slots.length} open times` : 'no open times'}`}
            onClick={() => setDay(i)}
            className={cn(
              'flex flex-col items-center rounded-xl border px-1 py-2 text-center transition-colors',
              day === i ? 'border-accent bg-accent-soft text-accent' : 'border-border hover:border-border-strong',
              !d.slots.length && day !== i && 'opacity-50',
            )}
          >
            <span className="text-[11px] uppercase tracking-wide">{d.date.toFormat('ccc')}</span>
            <span className="text-[15px] font-semibold tabular-nums">{d.date.toFormat('d')}</span>
            <span className="mt-0.5 text-[10.5px] text-muted-foreground">{slots.isLoading ? '…' : d.slots.length ? `${d.slots.length} open` : '—'}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-28" role="tabpanel">
        {slots.isError ? (
          <ErrorState message={errorMessage(slots.error)} onRetry={() => slots.refetch()} />
        ) : slots.isLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          // Keyed fade-in only: the previous day's slots unmount immediately (no exit animation), so a
          // quick click right after switching days can never select a time on the old day.
          <motion.div key={`${offset}-${day}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
              {byDay[day].slots.length ? (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {byDay[day].slots.map((s) => {
                    const active = selected === s.startAt;
                    return (
                      <button
                        key={s.startAt}
                        type="button"
                        onClick={() => onSelect(s)}
                        aria-pressed={active}
                        className={cn(
                          'h-10 rounded-xl border text-sm font-medium tabular-nums transition-all',
                          active ? 'border-accent bg-accent text-accent-foreground shadow-soft' : 'border-border bg-surface hover:-translate-y-px hover:border-accent/50 hover:text-accent',
                        )}
                      >
                        {DateTime.fromISO(s.startAt).setZone(timezone).toFormat('h:mm a')}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  {total ? 'No open times this day — try another day.' : 'No open times this week. Try the next week.'}
                </p>
              )}
          </motion.div>
        )}
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground">Times shown in {timezone.replace(/_/g, ' ')} ({DateTime.now().setZone(timezone).toFormat('ZZZZ')}).</p>
    </div>
  );
}
