'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Badge, Card, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { cn } from '@/utils/cn';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Templates() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'templates'], queryFn: adminService.templates });
  const [key, setKey] = useState<string | null>(null);
  const current = list.data?.find((t: any) => t.key === key) ?? list.data?.[0];
  const [draft, setDraft] = useState({ subject: '', htmlBody: '', textBody: '' });
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string } | null>(null);
  useEffect(() => current && setDraft({ subject: current.subject, htmlBody: current.htmlBody, textBody: current.textBody }), [current]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'templates'] });
  const save = useMutation({ mutationFn: () => adminService.updateTemplate(current.key, draft), onSuccess: () => { toast.success('Template saved'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const reset = useMutation({ mutationFn: () => adminService.resetTemplate(current.key), onSuccess: () => { toast.success('Reverted to default'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const showPreview = useMutation({ mutationFn: () => adminService.previewTemplate(current.key), onSuccess: setPreview, onError: (e) => toast.error(errorMessage(e)) });
  if (list.isError) return <ErrorState message={errorMessage(list.error)} />;
  if (!list.data) return <Skeleton className="h-96 rounded-2xl" />;
  const dirty = current && (draft.subject !== current.subject || draft.htmlBody !== current.htmlBody || draft.textBody !== current.textBody);
  return (
    <>
      <PageHeader title="Notification templates" description="Emails use {{variables}} that are HTML-escaped automatically. Scripts and event handlers are rejected." />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Templates" className="space-y-1">
          {list.data.map((t: any) => (
            <button key={t.key} onClick={() => setKey(t.key)} className={cn('w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-muted', current?.key === t.key && 'bg-accent-soft text-accent')}>
              <span className="flex items-center justify-between gap-2"><span className="font-medium">{t.key.replace(/_/g, ' ')}</span>{t.customized && <Badge tone="accent">edited</Badge>}</span>
              <span className="block text-[12px] text-muted-foreground">{t.description}</span>
            </button>
          ))}
        </nav>
        {current && (
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{current.category}</Badge>{current.mandatory && <Badge tone="warning">Always sent</Badge>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => showPreview.mutate()} loading={showPreview.isPending}><Eye />Preview saved</Button>
                {current.customized && <Button size="sm" variant="ghost" onClick={() => reset.mutate()} loading={reset.isPending}><RotateCcw />Reset</Button>}
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">Variables: {current.variables.map((v: string) => <code key={v} className="mr-1 rounded bg-muted px-1 py-0.5 font-mono">{`{{${v}}}`}</code>)}</p>
            <Field label="Subject" htmlFor="t-subject"><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
            <Field label="HTML body" htmlFor="t-html"><Textarea rows={10} className="font-mono text-[12.5px]" value={draft.htmlBody} onChange={(e) => setDraft({ ...draft, htmlBody: e.target.value })} /></Field>
            <Field label="Plain-text body" htmlFor="t-text"><Textarea rows={6} className="font-mono text-[12.5px]" value={draft.textBody} onChange={(e) => setDraft({ ...draft, textBody: e.target.value })} /></Field>
            <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>Save template</Button>
          </Card>
        )}
      </div>
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)} size="lg" title={preview?.subject ?? 'Preview'} description="Rendered with sample data.">
        {/* Sandboxed iframe: no scripts, no same-origin access. */}
        {preview && <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[60vh] w-full rounded-xl border border-border bg-white" />}
      </Dialog>
    </>
  );
}
