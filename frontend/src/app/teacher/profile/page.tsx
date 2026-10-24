'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Alert, Card, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { catalogService } from '@/services/catalog';
import { teacherService, type TeacherSelf } from '@/services/teacher';
import { formatMoney } from '@/utils/format';

function ProfileEditor() {
  const params = useSearchParams();
  const q = useQuery({ queryKey: ['teacher', 'me'], queryFn: teacherService.me });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[600px] rounded-2xl" />;
  return (
    <>
      <PageHeader
        title="Profile & subjects"
        description="This is what students see on your public profile."
        actions={q.data.approvalStatus === 'APPROVED' && <Button asChild variant="secondary"><Link href={`/teachers/${q.data.slug}`} target="_blank"><ExternalLink />View public profile</Link></Button>}
      />
      {params.get('welcome') && <Alert tone="info" title="Welcome to TeachMe!" className="mb-6">Complete your profile, add at least one subject and set your weekly hours. We’ll review your profile and email you once it’s approved.</Alert>}
      <div className="space-y-6">
        <About me={q.data} />
        <Subjects me={q.data} />
      </div>
    </>
  );
}

function About({ me }: { me: TeacherSelf }) {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [f, setF] = useState({ headline: me.headline, bio: me.bio, yearsExperience: me.yearsExperience, languages: me.languages.join(', '), avatarUrl: me.avatarUrl ?? '' });
  const [quals, setQuals] = useState(me.qualifications);
  const save = useMutation({
    mutationFn: () =>
      teacherService.update({
        headline: f.headline.trim(),
        bio: f.bio.trim(),
        yearsExperience: Number(f.yearsExperience) || 0,
        languages: f.languages.split(',').map((s) => s.trim()).filter(Boolean),
        qualifications: quals.filter((x) => x.title.trim() && x.institution.trim()).map((x) => ({ ...x, year: x.year ? Number(x.year) : undefined })),
        ...(f.avatarUrl.trim() ? { avatarUrl: f.avatarUrl.trim() } : {}),
      }),
    onSuccess: (d) => { qc.setQueryData(['teacher', 'me'], d); refresh(); toast.success('Profile saved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const headlineErr = f.headline.trim().length > 0 && f.headline.trim().length < 10 ? 'At least 10 characters' : undefined;
  const bioErr = f.bio.trim().length > 0 && f.bio.trim().length < 50 ? `At least 50 characters (${f.bio.trim().length}/50)` : undefined;
  return (
    <Card>
      <CardHeader title="About you" />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Headline" htmlFor="p-headline" error={headlineErr} hint="One line that tells students why to pick you." className="sm:col-span-2"><Input maxLength={140} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} /></Field>
        <Field label="Bio" htmlFor="p-bio" error={bioErr} hint="How you teach, who you help best, what a session looks like." className="sm:col-span-2"><Textarea rows={7} maxLength={4000} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
        <Field label="Years of teaching experience" htmlFor="p-years"><Input type="number" min={0} max={60} value={f.yearsExperience} onChange={(e) => setF({ ...f, yearsExperience: Number(e.target.value) })} /></Field>
        <Field label="Teaching languages" htmlFor="p-langs" hint="Comma separated"><Input value={f.languages} onChange={(e) => setF({ ...f, languages: e.target.value })} /></Field>
        <Field label="Photo URL (optional)" htmlFor="p-avatar" hint="An https:// link to a square photo" className="sm:col-span-2"><Input type="url" value={f.avatarUrl} onChange={(e) => setF({ ...f, avatarUrl: e.target.value })} placeholder="https://" /></Field>
        <div className="sm:col-span-2">
          <p className="text-[13px] font-medium">Qualifications</p>
          <div className="mt-2 space-y-2">
            {quals.map((x, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_100px_auto]">
                <Input aria-label="Qualification" placeholder="e.g. M.Sc. Physics" value={x.title} onChange={(e) => setQuals(quals.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} />
                <Input aria-label="Institution" placeholder="Institution" value={x.institution} onChange={(e) => setQuals(quals.map((y, j) => (j === i ? { ...y, institution: e.target.value } : y)))} />
                <Input aria-label="Year" type="number" placeholder="Year" value={x.year ?? ''} onChange={(e) => setQuals(quals.map((y, j) => (j === i ? { ...y, year: e.target.value ? Number(e.target.value) : undefined } : y)))} />
                <button onClick={() => setQuals(quals.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger" aria-label="Remove qualification"><Trash2 className="size-4" /></button>
              </div>
            ))}
            {quals.length < 10 && <Button size="sm" variant="ghost" onClick={() => setQuals([...quals, { title: '', institution: '' }])}><Plus />Add qualification</Button>}
          </div>
        </div>
        <div className="sm:col-span-2"><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!!headlineErr || !!bioErr}>Save profile</Button></div>
      </div>
    </Card>
  );
}

type Row = { subjectId: string; rupees: string; levels: string; isActive: boolean };

function Subjects({ me }: { me: TeacherSelf }) {
  const qc = useQueryClient();
  const catalogue = useQuery({ queryKey: ['public', 'subjects'], queryFn: catalogService.subjects, staleTime: 300_000 });
  const toRows = (m: TeacherSelf): Row[] => m.subjects.filter((s) => s.isActive).map((s) => ({ subjectId: s.subjectId, rupees: String(Math.round(s.hourlyRateMinor / 100)), levels: s.levels ?? '', isActive: true }));
  const [rows, setRows] = useState<Row[]>(toRows(me));
  useEffect(() => setRows(toRows(me)), [me]);
  const all = catalogue.data?.categories.flatMap((c) => c.subjects.map((s) => ({ ...s, category: c.name }))) ?? [];
  const { minHourlyRateMinor: min, maxHourlyRateMinor: max } = me.pricingBounds;
  const invalid = rows.some((r) => !r.subjectId || !/^\d+$/.test(r.rupees) || Number(r.rupees) * 100 < min || Number(r.rupees) * 100 > max) || new Set(rows.map((r) => r.subjectId)).size !== rows.length;
  const save = useMutation({
    mutationFn: () => teacherService.setSubjects(rows.map((r) => ({ subjectId: r.subjectId, hourlyRateMinor: Number.parseInt(r.rupees, 10) * 100, levels: r.levels.trim() || undefined }))),
    onSuccess: (d) => { qc.setQueryData(['teacher', 'me'], d); toast.success('Subjects saved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card id="subjects">
      <CardHeader title="Subjects & hourly rates" description={`Rates between ${formatMoney(min)} and ${formatMoney(max)} per hour. Students pay platform fees and tax on top.`} action={<Button onClick={() => save.mutate()} disabled={invalid} loading={save.isPending}>Save subjects</Button>} />
      {!me.canSetPricing && <Alert tone="info" className="m-5 mb-0">Rate changes are currently managed by the platform team. Contact support to change an existing rate.</Alert>}
      <div className="space-y-3 p-5">
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1.4fr_140px_1fr_auto] sm:items-center">
            <Select aria-label="Subject" value={r.subjectId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, subjectId: e.target.value } : x)))}>
              <option value="">Choose a subject…</option>
              {all.map((s) => <option key={s.id} value={s.id} disabled={rows.some((x, j) => j !== i && x.subjectId === s.id)}>{s.name} ({s.category})</option>)}
            </Select>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
              <Input aria-label="Hourly rate in rupees" inputMode="numeric" className="pl-7" value={r.rupees} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rupees: e.target.value.replace(/\D/g, '') } : x)))} />
            </div>
            <Input aria-label="Levels taught" placeholder="Levels, e.g. Class 9-12" value={r.levels} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, levels: e.target.value } : x)))} />
            <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-danger-soft hover:text-danger" aria-label="Remove subject"><Trash2 className="size-4" /></button>
          </div>
        ))}
        {rows.length < 12 && <Button variant="ghost" onClick={() => setRows([...rows, { subjectId: '', rupees: String(Math.round(min / 100) * 2), levels: '', isActive: true }])}><Plus />Add subject</Button>}
        {invalid && rows.length > 0 && <p className="text-[13px] text-danger">Each row needs a unique subject and a whole-rupee rate within the allowed range.</p>}
      </div>
    </Card>
  );
}

export default function Page() {
  return <Suspense><ProfileEditor /></Suspense>;
}
