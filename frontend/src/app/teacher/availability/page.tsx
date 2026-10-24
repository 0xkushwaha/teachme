'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Select } from '@/components/ui/form';
import { Alert, Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { teacherService, type AvailabilityState } from '@/services/teacher';
import { formatDateTime, minutesToLabel } from '@/utils/format';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TIMES = Array.from({ length: 49 }, (_, i) => i * 30);
type W = { dayOfWeek: number; startMinute: number; endMinute: number };

export default function AvailabilityPage() {
  const q = useQuery({ queryKey: ['teacher', 'availability'], queryFn: teacherService.availability });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[600px] rounded-2xl" />;
  return (
    <>
      <PageHeader title="Availability" description={`Times are in your teaching timezone: ${q.data.settings.timezone.replace(/_/g, ' ')}. Students see them converted to theirs.`} />
      <div className="space-y-6">
        <WeeklyHours data={q.data} />
        <Exceptions data={q.data} />
        <TeachingRules data={q.data} />
      </div>
    </>
  );
}

function WeeklyHours({ data }: { data: AvailabilityState }) {
  const qc = useQueryClient();
  const [windows, setWindows] = useState<W[]>([]);
  useEffect(() => setWindows(data.windows.map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute }))), [data.windows]);
  const dirty = JSON.stringify(windows) !== JSON.stringify(data.windows.map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute })));
  const invalid = windows.some((w) => w.endMinute <= w.startMinute);
  const save = useMutation({ mutationFn: () => teacherService.setWeekly(windows), onSuccess: (d) => { qc.setQueryData(['teacher', 'availability'], d); toast.success('Weekly hours saved'); }, onError: (e) => toast.error(errorMessage(e)) });
  const update = (idx: number, patch: Partial<W>) => setWindows((ws) => ws.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  return (
    <Card>
      <CardHeader title="Weekly hours" description="Your regular teaching hours. Breaks are simply gaps between windows." action={<Button onClick={() => save.mutate()} disabled={!dirty || invalid} loading={save.isPending}>Save hours</Button>} />
      <div className="divide-y divide-border">
        {DAYS.map((day, d) => {
          const list = windows.map((w, i) => ({ w, i })).filter((x) => x.w.dayOfWeek === d + 1);
          return (
            <div key={day} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
              <p className="w-32 pt-2 text-sm font-medium">{day}</p>
              <div className="flex-1 space-y-2">
                {list.length === 0 && <p className="pt-2 text-sm text-muted-foreground">Unavailable</p>}
                {list.map(({ w, i }) => (
                  <div key={i} className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`s-${i}`}>{day} start</label>
                    <Select id={`s-${i}`} value={w.startMinute} onChange={(e) => update(i, { startMinute: Number(e.target.value) })} className="w-32">
                      {TIMES.slice(0, -1).map((t) => <option key={t} value={t}>{minutesToLabel(t)}</option>)}
                    </Select>
                    <span className="text-muted-foreground">–</span>
                    <label className="sr-only" htmlFor={`e-${i}`}>{day} end</label>
                    <Select id={`e-${i}`} value={w.endMinute} onChange={(e) => update(i, { endMinute: Number(e.target.value) })} className="w-32" aria-invalid={w.endMinute <= w.startMinute}>
                      {TIMES.slice(1).map((t) => <option key={t} value={t}>{t === 1440 ? 'Midnight' : minutesToLabel(t)}</option>)}
                    </Select>
                    <button onClick={() => setWindows((ws) => ws.filter((_, j) => j !== i))} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${day} window`}><Trash2 className="size-4" /></button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setWindows((ws) => [...ws, { dayOfWeek: d + 1, startMinute: 9 * 60, endMinute: 12 * 60 }])}><Plus />Add hours</Button>
            </div>
          );
        })}
      </div>
      {invalid && <p className="px-5 pb-4 text-[13px] text-danger">Each window must end after it starts.</p>}
    </Card>
  );
}

function Exceptions({ data }: { data: AvailabilityState }) {
  const qc = useQueryClient();
  const tz = data.settings.timezone;
  const [type, setType] = useState<'UNAVAILABLE' | 'AVAILABLE'>('UNAVAILABLE');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['teacher', 'availability'] });
  const add = useMutation({
    mutationFn: () => teacherService.addException({ type, startAt: DateTime.fromISO(start, { zone: tz }).toUTC().toISO()!, endAt: DateTime.fromISO(end, { zone: tz }).toUTC().toISO()!, reason: reason || undefined }),
    onSuccess: (r) => {
      refresh();
      setStart(''); setEnd(''); setReason('');
      if (r.affectedConfirmedBookings) toast.warning(`Saved. ${r.affectedConfirmedBookings} confirmed session(s) fall in this period — reschedule or cancel them from Bookings.`);
      else toast.success('Exception added');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: teacherService.removeException, onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const valid = start && end && DateTime.fromISO(end) > DateTime.fromISO(start);
  return (
    <Card>
      <CardHeader title="Holidays, breaks & extra hours" description="One-off changes that override your weekly hours." />
      <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-[160px_1fr_1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5"><Label htmlFor="ex-type">Type</Label><Select id="ex-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="UNAVAILABLE">Unavailable</option><option value="AVAILABLE">Extra hours</option></Select></div>
        <div className="space-y-1.5"><Label htmlFor="ex-start">From</Label><Input id="ex-start" type="datetime-local" step={1800} value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="ex-end">Until</Label><Input id="ex-end" type="datetime-local" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="ex-reason">Note (optional)</Label><Input id="ex-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Diwali holiday" /></div>
        <Button onClick={() => add.mutate()} disabled={!valid} loading={add.isPending}>Add</Button>
      </div>
      {data.exceptions.length ? (
        <ul className="divide-y divide-border">
          {data.exceptions.map((x) => (
            <li key={x.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <Badge tone={x.type === 'UNAVAILABLE' ? 'danger' : 'success'}>{x.type === 'UNAVAILABLE' ? 'Off' : 'Extra'}</Badge>
              <span className="flex-1">{formatDateTime(x.startAt, tz)} → {formatDateTime(x.endAt, tz)}{x.reason && <span className="text-muted-foreground"> · {x.reason}</span>}</span>
              <button onClick={() => remove.mutate(x.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-danger-soft hover:text-danger" aria-label="Remove exception"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      ) : <div className="p-5"><EmptyState icon={<CalendarOff />} title="No upcoming exceptions" /></div>}
    </Card>
  );
}

function TeachingRules({ data }: { data: AvailabilityState }) {
  const qc = useQueryClient();
  const [s, setS] = useState(data.settings);
  useEffect(() => setS(data.settings), [data.settings]);
  const save = useMutation({ mutationFn: () => teacherService.updateSettings(s), onSuccess: (d) => { qc.setQueryData(['teacher', 'availability'], d); toast.success('Rules saved'); }, onError: (e) => toast.error(errorMessage(e)) });
  const toggleDuration = (d: number) => setS((p) => ({ ...p, sessionDurations: p.sessionDurations.includes(d) ? p.sessionDurations.filter((x) => x !== d) : [...p.sessionDurations, d].sort((a, b) => a - b) }));
  return (
    <Card>
      <CardHeader title="Booking rules" />
      <div className="space-y-5 p-5">
        <fieldset>
          <legend className="text-[13px] font-medium">Session lengths you offer</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.allowedDurations.map((d) => (
              <label key={d} className={`cursor-pointer rounded-xl border px-3 py-1.5 text-sm ${s.sessionDurations.includes(d) ? 'border-accent bg-accent-soft text-accent' : 'border-border'}`}>
                <input type="checkbox" className="sr-only" checked={s.sessionDurations.includes(d)} onChange={() => toggleDuration(d)} />{d} min
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Buffer between sessions" htmlFor="r-buffer" hint="Minutes kept free after each session"><Select value={s.bufferMinutes} onChange={(e) => setS({ ...s, bufferMinutes: Number(e.target.value) })}>{[0, 5, 10, 15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Select></Field>
          <Field label="Minimum notice" htmlFor="r-notice" hint="How soon before a session students can book"><Select value={s.minNoticeMinutes} onChange={(e) => setS({ ...s, minNoticeMinutes: Number(e.target.value) })}>{[60, 180, 360, 720, 1440, 2880].map((m) => <option key={m} value={m}>{m < 1440 ? `${m / 60} hours` : `${m / 1440} day${m > 1440 ? 's' : ''}`}</option>)}</Select></Field>
          <Field label="Book up to" htmlFor="r-advance" hint="How far ahead students can book"><Select value={s.maxAdvanceDays} onChange={(e) => setS({ ...s, maxAdvanceDays: Number(e.target.value) })}>{[14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}</Select></Field>
        </div>
        {!s.sessionDurations.length && <Alert tone="warning">Pick at least one session length.</Alert>}
        <Button onClick={() => save.mutate()} disabled={!s.sessionDurations.length} loading={save.isPending}>Save rules</Button>
      </div>
    </Card>
  );
}
