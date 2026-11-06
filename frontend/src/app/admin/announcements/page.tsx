'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService, type Announcement, type AnnouncementInput } from '@/services/admin';
import { browserTimezone, formatDateTime } from '@/utils/format';

const AUDIENCE: Record<Announcement['audience'], string> = { ALL: 'Everyone', STUDENT: 'Students', TEACHER: 'Toppers' };
const toLocal = (iso?: string | null) => (iso ? DateTime.fromISO(iso).toFormat("yyyy-MM-dd'T'HH:mm") : '');
const fromLocal = (v: string) => (v ? DateTime.fromISO(v).toISO()! : undefined);

function state(a: Announcement) {
  const now = Date.now();
  if (a.archivedAt) return { label: 'Archived', tone: 'neutral' as const };
  if (new Date(a.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'accent' as const };
  if (a.endsAt && new Date(a.endsAt).getTime() <= now) return { label: 'Ended', tone: 'neutral' as const };
  return { label: 'Live', tone: 'success' as const };
}

export default function AdminAnnouncements() {
  const qc = useQueryClient();
  const zone = browserTimezone();
  const [view, setView] = useState('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const q = useQuery({ queryKey: ['admin', 'announcements', view, page], queryFn: () => adminService.announcements({ view, page }), placeholderData: keepPreviousData });
  const archive = useMutation({
    mutationFn: (id: string) => adminService.archiveAnnouncement(id),
    onSuccess: () => { toast.success('Announcement archived'); setArchiving(null); qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => adminService.deleteAnnouncement(id),
    onSuccess: () => { toast.success('Announcement deleted'); setDeleting(null); qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }); qc.invalidateQueries({ queryKey: ['announcements'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Announcements" description="Short notices shown at the top of student and topper dashboards." actions={<Button onClick={() => setEditing('new')}><Plus />New announcement</Button>} />
      <Tabs className="mb-4" value={view} onValueChange={(v) => { setView(v); setPage(1); }} items={[{ value: 'active', label: 'Current & scheduled' }, { value: 'archived', label: 'Archived' }]} />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-48 rounded-2xl" /> : q.data.data.length === 0 ? (
        <EmptyState icon={<Megaphone />} title="No announcements" description="Use announcements for schedule changes, policy updates or planned maintenance." />
      ) : (
        <>
          <div className="space-y-3">
            {q.data.data.map((a) => {
              const st = state(a);
              return (
                <Card key={a.id} className="p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{a.title}</p><Badge tone={st.tone}>{st.label}</Badge><Badge>{AUDIENCE[a.audience]}</Badge></div>
                      <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
                      <p className="mt-2 text-[12.5px] text-muted-foreground">From {formatDateTime(a.startsAt, zone)}{a.endsAt ? ` until ${formatDateTime(a.endsAt, zone)}` : ' · no end date'}</p>
                    </div>
                    <div className="flex gap-2">
                      {!a.archivedAt && <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>Edit</Button>}
                      {!a.archivedAt && <Button size="sm" variant="ghost" onClick={() => setArchiving(a)}>Archive</Button>}
                      <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDeleting(a)}><Trash2 />Delete</Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      )}
      {editing && <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Dialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title={`Archive “${archiving?.title ?? ''}”?`}
        description="It disappears from dashboards immediately."
        footer={<><Button variant="secondary" onClick={() => setArchiving(null)}>Cancel</Button><Button variant="danger" loading={archive.isPending} onClick={() => archiving && archive.mutate(archiving.id)}>Archive</Button></>}
      />
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.title ?? ''}”?`}
        description="It is removed permanently, including from the archive. This cannot be undone."
        footer={<><Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete</Button></>}
      />
    </>
  );
}

function Editor({ initial, onClose }: { initial: Announcement | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: initial?.title ?? '', body: initial?.body ?? '', audience: initial?.audience ?? 'ALL', startsAt: toLocal(initial?.startsAt), endsAt: toLocal(initial?.endsAt) });
  const windowOk = !f.endsAt || !f.startsAt || f.endsAt > f.startsAt;
  const valid = f.title.trim().length >= 3 && f.body.trim().length >= 3 && windowOk;
  const save = useMutation({
    mutationFn: () => {
      const body: AnnouncementInput = { title: f.title.trim(), body: f.body.trim(), audience: f.audience as Announcement['audience'], startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt) ?? null };
      return initial ? adminService.updateAnnouncement(initial.id, body) : adminService.createAnnouncement(body);
    },
    onSuccess: () => { toast.success(initial ? 'Announcement updated' : 'Announcement published'); qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }); qc.invalidateQueries({ queryKey: ['announcements'] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={initial ? 'Edit announcement' : 'New announcement'}
      description="Plain text only. Keep it short — it appears above every page of the chosen dashboards."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{initial ? 'Save' : 'Publish'}</Button></>}
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="ann-title"><Input maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message" htmlFor="ann-body"><Textarea rows={4} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Show to" htmlFor="ann-aud"><Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as Announcement['audience'] })}>{Object.entries(AUDIENCE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="ann-start" hint="Empty = now"><Input type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} /></Field>
          <Field label="Ends" htmlFor="ann-end" error={windowOk ? undefined : 'Must be after the start'} hint="Empty = until archived"><Input type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
