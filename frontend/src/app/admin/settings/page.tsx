'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/form';
import { Switch } from '@/components/ui/overlay';
import { Card, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { ApiError, errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FLAG_LABELS: Record<string, string> = {
  studentRegistration: 'Student registration open',
  teacherRegistration: 'Teacher applications open',
  googleCalendarSync: 'Google Calendar sync',
  meetCreation: 'Create Google Meet links',
  teacherSelfPricing: 'Teachers can change their own rates',
};

function JsonSetting({ s }: { s: { key: string; description: string; value: any } }) {
  const qc = useQueryClient();
  const [text, setText] = useState(JSON.stringify(s.value, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(s.value, null, 2)), [s.value]);
  const save = useMutation({
    mutationFn: () => adminService.setSetting(s.key, JSON.parse(text)),
    onSuccess: () => { setErr(null); toast.success(`${s.key} saved`); qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); },
    onError: (e) => setErr(e instanceof SyntaxError ? 'Invalid JSON' : e instanceof ApiError && Array.isArray(e.details) ? (e.details as any[]).map((d) => `${d.path?.join('.')}: ${d.message}`).join('; ') : errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title={<code className="font-mono text-[14px]">{s.key}</code>} description={s.description} action={<Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={text === JSON.stringify(s.value, null, 2)}>Save</Button>} />
      <div className="p-5">
        <label htmlFor={`set-${s.key}`} className="sr-only">{s.key}</label>
        <Textarea id={`set-${s.key}`} rows={Math.min(12, text.split('\n').length + 1)} className="font-mono text-[12.5px]" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!err} />
        {err && <p role="alert" className="mt-2 text-[12.5px] text-danger">{err}</p>}
        <p className="mt-2 text-[12px] text-muted-foreground">Money is in paise; rates are basis points (500 = 5%). Changes apply to new bookings only.</p>
      </div>
    </Card>
  );
}

function Flags({ value }: { value: any }) {
  const qc = useQueryClient();
  const [flags, setFlags] = useState(value);
  useEffect(() => setFlags(value), [value]);
  const save = useMutation({ mutationFn: (v: any) => adminService.setSetting('features.flags', v), onSuccess: () => { toast.success('Feature flags saved'); qc.invalidateQueries({ queryKey: ['admin', 'settings'] }); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <Card>
      <CardHeader title="Feature flags" description="Take effect within about 10 seconds on all servers." />
      <div className="divide-y divide-border">
        {Object.keys(FLAG_LABELS).map((k) => (
          <div key={k} className="flex items-center justify-between px-5 py-3">
            <Label htmlFor={`flag-${k}`}>{FLAG_LABELS[k]}</Label>
            <Switch id={`flag-${k}`} checked={!!flags[k]} onCheckedChange={(v) => { const next = { ...flags, [k]: v }; setFlags(next); save.mutate(next); }} />
          </div>
        ))}
        <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5"><Label htmlFor="banner">Site-wide banner (optional)</Label><Input id="banner" maxLength={280} value={flags.maintenanceBanner ?? ''} onChange={(e) => setFlags({ ...flags, maintenanceBanner: e.target.value })} placeholder="e.g. Scheduled maintenance Sunday 02:00–03:00 IST" /></div>
          <Button variant="secondary" onClick={() => save.mutate({ ...flags, maintenanceBanner: flags.maintenanceBanner?.trim() || null })}>Save banner</Button>
        </div>
      </div>
    </Card>
  );
}

export default function Settings() {
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: adminService.settings });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} />;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const flags = q.data.find((s) => s.key === 'features.flags');
  return (
    <>
      <PageHeader title="System settings" description="Booking, pricing, policy and reminder configuration. Every change is validated server-side and recorded in the audit log." />
      <div className="space-y-6">
        {flags && <Flags value={flags.value} />}
        {q.data.filter((s) => s.key !== 'features.flags').map((s) => <JsonSetting key={s.key} s={s} />)}
      </div>
    </>
  );
}
