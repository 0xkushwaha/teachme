'use client';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { CheckCircle2, Circle, Download, FileText, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Alert, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { teacherService, type ApplicationState, type TeacherDocument } from '@/services/teacher';
import { browserTimezone, formatDateTime, relative } from '@/utils/format';

const DOC_TYPES: { value: TeacherDocument['type']; label: string }[] = [
  { value: 'DEGREE', label: 'Degree' },
  { value: 'CERTIFICATE', label: 'Teaching certificate' },
  { value: 'EXPERIENCE', label: 'Experience letter' },
  { value: 'ID_PROOF', label: 'Identity proof' },
  { value: 'OTHER', label: 'Other' },
];
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

const STEPS: { key: keyof ApplicationState['checklist']; label: string; href?: string }[] = [
  { key: 'emailVerified', label: 'Verify your email address' },
  { key: 'profile', label: 'Write a headline and bio', href: '/teacher/profile' },
  { key: 'subjects', label: 'Add at least one subject and rate', href: '/teacher/profile#subjects' },
  { key: 'availability', label: 'Set your weekly availability', href: '/teacher/availability' },
  { key: 'documents', label: 'Upload qualification documents' },
];

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function Application() {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const welcome = useSearchParams().get('welcome');
  const app = useQuery({ queryKey: ['teacher', 'application'], queryFn: teacherService.application });
  const docs = useQuery({ queryKey: ['teacher', 'documents'], queryFn: teacherService.documents });
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const submit = useMutation({
    mutationFn: teacherService.submitApplication,
    onSuccess: (d) => {
      qc.setQueryData(['teacher', 'application'], d);
      refresh();
      setConfirmSubmit(false);
      toast.success('Application submitted. We’ll email you when it’s reviewed.');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (app.isError) return <ErrorState message={errorMessage(app.error)} onRetry={() => app.refetch()} />;
  if (!app.data) return <Skeleton className="h-[560px] rounded-2xl" />;
  const a = app.data;
  const locked = a.underReview;

  return (
    <>
      <PageHeader eyebrow="Topper onboarding" title="Application & documents" description="Everything an administrator needs to approve your profile." />
      {welcome && <Alert tone="success" title="Your account is ready" className="mb-6">Work through the checklist below, then submit your application for review.</Alert>}
      {a.status === 'APPROVED' && <Alert tone="success" title="You’re approved" className="mb-6">Students can find and book you. Keep your documents up to date here.</Alert>}
      {a.status === 'REJECTED' && (
        <Alert tone="danger" title="Your application needs changes" className="mb-6">
          {a.rejectionReason ? <>Reviewer’s note: <span className="text-foreground">{a.rejectionReason}</span>. </> : null}
          Update your profile or documents, then submit again.
        </Alert>
      )}
      {a.underReview && a.submittedAt && (
        <Alert tone="info" title="Under review" className="mb-6">
          Submitted {relative(a.submittedAt)}. We’ll email you with a decision. Documents are locked while the review is in progress.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card className="h-fit">
          <CardHeader title="Checklist" description={a.submittedAt ? `Last submitted ${formatDateTime(a.submittedAt, browserTimezone())}` : 'Not submitted yet'} action={<StatusBadge status={a.status} />} />
          <ol className="space-y-1 p-3">
            {STEPS.map((s) => {
              const done = a.checklist[s.key];
              const label = s.key === 'documents' && !a.requireDocuments ? `${s.label} (optional)` : s.label;
              return (
                <li key={s.key} className="flex items-center gap-3 rounded-xl px-2 py-2">
                  {done ? <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden /> : <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className={done ? 'text-sm text-muted-foreground' : 'text-sm font-medium'}>
                    {label}
                    <span className="sr-only">{done ? ' — done' : ' — to do'}</span>
                  </span>
                  {!done && s.href && <Link href={s.href} className="ml-auto text-[13px] font-medium text-accent hover:underline">Open</Link>}
                </li>
              );
            })}
          </ol>
          {(a.status === 'PENDING' || a.status === 'REJECTED') && !locked && (
            <div className="border-t border-border p-5">
              <Button className="w-full" disabled={!a.canSubmit} onClick={() => setConfirmSubmit(true)}>
                {a.status === 'REJECTED' ? 'Resubmit application' : 'Submit application'}
              </Button>
              {!a.canSubmit && !locked && <p className="mt-2 text-center text-[12.5px] text-muted-foreground">Complete every step to submit.</p>}
            </div>
          )}
        </Card>

        <Documents docs={docs} locked={locked} approved={a.status === 'APPROVED'} />
      </div>

      <Dialog
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        title="Submit your application?"
        description="An administrator will review your profile and documents. You won’t be able to change documents until a decision is made."
        footer={<><Button variant="secondary" onClick={() => setConfirmSubmit(false)}>Not yet</Button><Button loading={submit.isPending} onClick={() => submit.mutate()}>Submit for review</Button></>}
      />
    </>
  );
}

function Documents({ docs, locked, approved }: { docs: UseQueryResult<TeacherDocument[]>; locked: boolean; approved: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<TeacherDocument['type']>('DEGREE');
  const [title, setTitle] = useState('');
  const [fileError, setFileError] = useState<string>();
  const [removing, setRemoving] = useState<TeacherDocument | null>(null);
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['teacher', 'documents'] });
    qc.invalidateQueries({ queryKey: ['teacher', 'application'] });
  };
  const upload = useMutation({
    mutationFn: () => teacherService.uploadDocument(file!, type, title.trim()),
    onSuccess: () => {
      toast.success('Document uploaded');
      setFile(null);
      setTitle('');
      if (fileRef.current) fileRef.current.value = '';
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => teacherService.deleteDocument(id),
    onSuccess: () => { toast.success('Document removed'); setRemoving(null); refreshAll(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const pick = (f: File | undefined) => {
    setFileError(undefined);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) return setFileError('Files must be 5 MB or smaller');
    if (!ACCEPT.split(',').includes(f.type)) return setFileError('Upload a PDF, PNG, JPEG or WebP file');
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').slice(0, 120));
  };

  return (
    <Card>
      <CardHeader title="Qualification documents" description="Degrees, certificates or experience letters. PDF or image, up to 5 MB each. Only you and TeachMe administrators can open them." />
      {!locked && (
        <form className="grid gap-3 border-b border-border p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); upload.mutate(); }}>
          <Field label="File" htmlFor="doc-file" error={fileError} className="sm:col-span-2">
            <Input ref={fileRef} type="file" accept={ACCEPT} className="h-auto py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:text-[13px] file:font-medium file:text-accent" onChange={(e) => pick(e.target.files?.[0])} />
          </Field>
          <Field label="Document type" htmlFor="doc-type">
            <Select value={type} onChange={(e) => setType(e.target.value as TeacherDocument['type'])}>{DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
          </Field>
          <Field label="Title" htmlFor="doc-title" hint="e.g. M.Sc. Physics, Delhi University">
            <Input maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={!file || title.trim().length < 2} loading={upload.isPending}><Upload />Upload document</Button>
          </div>
        </form>
      )}
      <div className="p-5">
        {docs.isError ? <ErrorState message={errorMessage(docs.error)} onRetry={() => docs.refetch()} /> : !docs.data ? <Skeleton className="h-32" /> : docs.data.length === 0 ? (
          <EmptyState icon={<FileText />} title="No documents yet" description="Upload at least one document that proves your qualifications or teaching experience." />
        ) : (
          <ul className="divide-y divide-border">
            {docs.data.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.title}</p>
                    <p className="text-[12.5px] text-muted-foreground">{DOC_TYPES.find((t) => t.value === d.type)?.label} · {d.file.fileName} · {formatSize(d.file.sizeBytes)} · uploaded {relative(d.createdAt)}</p>
                    {d.reviewStatus === 'REJECTED' && d.reviewNote && <p className="mt-1 text-[12.5px] text-danger">Reviewer: {d.reviewNote}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={d.reviewStatus} label={d.reviewStatus === 'PENDING' ? 'Not reviewed' : undefined} />
                  <Button asChild size="sm" variant="ghost"><a href={teacherService.documentUrl(d.id)} aria-label={`Download ${d.title}`}><Download /></a></Button>
                  {!locked && !(approved && d.reviewStatus === 'VERIFIED') && (
                    <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(d)} aria-label={`Remove ${d.title}`}><Trash2 /></Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove “${removing?.title ?? ''}”?`}
        description="The file is deleted permanently."
        footer={<><Button variant="secondary" onClick={() => setRemoving(null)}>Keep it</Button><Button variant="danger" loading={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>Remove</Button></>}
      />
    </Card>
  );
}

export default function Page() {
  return <Suspense><Application /></Suspense>;
}
