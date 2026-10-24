'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { Tabs } from '@/components/ui/overlay';
import type { Booking } from '@/types/api';
import { cn } from '@/utils/cn';

export type CalView = 'day' | 'week' | 'month';

export function rangeFor(view: CalView, anchor: DateTime) {
  if (view === 'day') return { from: anchor.startOf('day'), to: anchor.endOf('day') };
  if (view === 'week') return { from: anchor.startOf('week'), to: anchor.endOf('week') };
  const from = anchor.startOf('month').startOf('week');
  return { from, to: from.plus({ weeks: 6 }).minus({ milliseconds: 1 }) };
}

const tone: Record<string, string> = {
  CONFIRMED: 'border-l-accent bg-accent-soft/70 text-foreground',
  COMPLETED: 'border-l-border-strong bg-muted text-muted-foreground',
  PENDING_PAYMENT: 'border-l-warning bg-warning-soft text-foreground',
};

export function CalendarView({ bookings, timezone, view, onView, anchor, onAnchor, hrefFor, label }: {
  bookings: Booking[];
  timezone: string;
  view: CalView;
  onView: (v: CalView) => void;
  anchor: DateTime;
  onAnchor: (d: DateTime) => void;
  hrefFor: (b: Booking) => string;
  label: (b: Booking) => string;
}) {
  const { from } = rangeFor(view, anchor);
  const step = view === 'day' ? { days: 1 } : view === 'week' ? { weeks: 1 } : { months: 1 };
  const title = view === 'day' ? anchor.toFormat('cccc, d LLLL yyyy') : view === 'week' ? `${from.toFormat('d LLL')} – ${from.plus({ days: 6 }).toFormat('d LLL yyyy')}` : anchor.toFormat('LLLL yyyy');
  const today = DateTime.now().setZone(timezone);
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const k = DateTime.fromISO(b.startAt).setZone(timezone).toISODate()!;
    byDay.set(k, [...(byDay.get(k) ?? []), b]);
  }
  const days = view === 'day' ? [anchor.startOf('day')] : Array.from({ length: view === 'week' ? 7 : 42 }, (_, i) => from.plus({ days: i }));

  const Event = ({ b, compact }: { b: Booking; compact?: boolean }) => (
    <Link href={hrefFor(b)} className={cn('block rounded-lg border-l-[3px] px-2 py-1 text-[12px] leading-tight transition-shadow hover:shadow-soft', tone[b.status] ?? 'border-l-border bg-muted')}>
      <span className="font-medium tabular-nums">{DateTime.fromISO(b.startAt).setZone(timezone).toFormat('h:mm a')}</span>
      {!compact && <span className="block truncate">{label(b)}</span>}
    </Link>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="grid size-8 place-items-center rounded-lg border border-border hover:bg-muted" onClick={() => onAnchor(anchor.minus(step))} aria-label="Previous"><ChevronLeft className="size-4" /></button>
          <button className="grid size-8 place-items-center rounded-lg border border-border hover:bg-muted" onClick={() => onAnchor(anchor.plus(step))} aria-label="Next"><ChevronRight className="size-4" /></button>
          <button className="rounded-lg border border-border px-3 py-1.5 text-[13px] hover:bg-muted" onClick={() => onAnchor(today)}>Today</button>
          <h2 className="ml-2 font-semibold" aria-live="polite">{title}</h2>
        </div>
        <Tabs value={view} onValueChange={(v) => onView(v as CalView)} items={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </div>

      {view === 'day' ? (
        <div className="rounded-2xl border border-border bg-surface p-4">
          {(byDay.get(anchor.toISODate()!) ?? []).length ? (
            <div className="space-y-2">{byDay.get(anchor.toISODate()!)!.map((b) => <Event key={b.id} b={b} />)}</div>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {days.slice(0, 7).map((d) => <div key={d.toISODate()} className="py-2">{d.toFormat('ccc')}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const list = byDay.get(d.toISODate()!) ?? [];
              const outside = view === 'month' && d.month !== anchor.month;
              const isToday = d.hasSame(today, 'day');
              return (
                <div key={d.toISODate()} className={cn('border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0', view === 'week' ? 'min-h-48' : 'min-h-24', outside && 'bg-surface-2/50')}>
                  <div className={cn('mb-1 grid size-6 place-items-center rounded-full text-[12px] tabular-nums', isToday ? 'bg-accent font-semibold text-accent-foreground' : outside ? 'text-muted-foreground/60' : 'text-muted-foreground')}>{d.day}</div>
                  <div className="space-y-1">
                    {list.slice(0, view === 'month' ? 3 : 12).map((b) => <Event key={b.id} b={b} compact={view === 'month'} />)}
                    {view === 'month' && list.length > 3 && <button className="text-[11px] text-accent" onClick={() => { onAnchor(d); onView('day'); }}>+{list.length - 3} more</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted-foreground">Times in {timezone.replace(/_/g, ' ')}.</p>
    </div>
  );
}
