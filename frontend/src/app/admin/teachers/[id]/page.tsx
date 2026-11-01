'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, ExternalLink, FileText, XCircle } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { Alert, Avatar, Badge, Card, CardHeader, EmptyState, ErrorState, Pagination, Skeleton, StatCard, StatusBadge, Table } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatDate, formatDateTime, formatMoney, minutesToLabel, relative, STATUS_LABEL } from '@/utils/format';

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOC_LABEL: Record<string, string> = { DEGREE: 'Degree', CERTIFICATE: 'Teaching certificate', EXPERIENCE: 'Experience letter', ID_PROOF: 'Identity proof', OTHER: 'Other' };

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AdminTeacherDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'teacher', id], queryFn: () => adminService.teacher(id) });
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED' | 'SUSPENDED' | null>(null);
  const [note, setNote] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'teacher', id] });
    qc.invalidateQueries({ queryKey: ['admin', 'teachers'] });
  };
  const decide = useMutation({
    mutationFn: () => adminService.setApproval(id, decision!, note.trim() || undefined),
    onSuccess: () => { toast.success('Teacher updated and notified'); setDecision(null); setNote(''); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[600px] rounded-2xl" />;
  const t = q.data;
  const zone = t.timezone;
  const submitted = Boolean(t.applicationSubmittedAt);
  const reviewable = (t.approvalStatus === 'PENDING' || t.approvalStatus === 'REJECTED') && submitted;
  const complete = t.headline.length >= 10 && t.bio.length >= 50 && t.subjects.some((s: any) => s.isActive);

  return (
    <>
      <Link href="/admin/teachers" className="text-[13px] text-muted-foreground hover:text-foreground">← All teachers</Link>
      <div className="mb-6 mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar name={t.user.fullName} src={t.avatarUrl} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t.user.fullName}</h1>
            <StatusBadge status={t.approvalStatus} />
            {t.user.status !== 'ACTIVE' && <StatusBadge status={t.user.status} />}
          </div>
          <p className="text-sm text-muted-foreground">{t.user.email} · joined {formatDate(t.user.createdAt, zone)}{t.invitation ? ' · invited' : ' · self-registered'}{t.user.lastLoginAt ? ` · last sign-in ${relative(t.user.lastLoginAt)}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {t.approvalStatus === 'APPROVED' && <Button asChild variant="ghost"><Link href={`/teachers/${t.slug}`} target="_blank"><ExternalLink />Public profile</Link></Button>}
          {(reviewable || t.approvalStatus === 'SUSPENDED') && <Button disabled={!complete} onClick={() => setDecision('APPROVED')}><CheckCircle2 />{t.approvalStatus === 'SUSPENDED' ? 'Reactivate' : 'Approve'}</Button>}
          {t.approvalStatus === 'PENDING' && submitted && <Button variant="secondary" onClick={() => setDecision('REJECTED')}><XCircle />Reject</Button>}
          {t.approvalStatus === 'APPROVED' && <Button variant="secondary" className="text-danger" onClick={() => setDecision('SUSPENDED')}>Suspend</Button>}
        </div>
      </div>

      {t.approvalStatus === 'PENDING' && !submitted && <Alert tone="info" title="Application not submitted yet" className="mb-6">The teacher is still completing their profile. You can approve once they submit.</Alert>}
      {t.approvalStatus === 'REJECTED' && t.rejectionReason && <Alert tone="warning" title="Rejected" className="mb-6">Reason sent to the teacher: {t.rejectionReason}</Alert>}
      {reviewable && !complete && <Alert tone="warning" title="Profile incomplete" className="mb-6">Approval needs a headline (10+ characters), a bio (50+ characters) and at least one active subject.</Alert>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Completed sessions" value={t.stats.bookings.COMPLETED ?? 0} />
        <StatCard label="Upcoming sessions" value={t.stats.upcoming} />
        <StatCard label="Cancelled" value={t.stats.bookings.CANCELLED ?? 0} />
        <StatCard label="Lifetime earnings" value={formatMoney(t.stats.lifetimeEarningsMinor)} hint={t.stats.openPayout ? `Open payout ${formatMoney(t.stats.openPayout.amountMinor)} (${t.stats.openPayout.status.toLowerCase()})` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Documents teacherId={id} docs={t.documents} onChange={refresh} />
          <Card>
            <CardHeader title="Profile" description={t.applicationSubmittedAt ? `Submitted ${formatDateTime(t.applicationSubmittedAt, zone)}` : undefined} />
            <div className="space-y-4 p-5 text-sm">
              <div><p className="text-[12px] text-muted-foreground">Headline</p><p>{t.headline || '—'}</p></div>
              <div><p className="text-[12px] text-muted-foreground">Bio</p><p className="whitespace-pre-line">{t.bio || '—'}</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><p className="text-[12px] text-muted-foreground">Experience</p><p>{t.yearsExperience} years</p></div>
                <div><p className="text-[12px] text-muted-foreground">Languages</p><p>{t.languages.join(', ') || '—'}</p></div>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground">Stated qualifications</p>
                {(t.qualifications as any[]).length ? <ul className="mt-1 list-disc pl-5">{(t.qualifications as any[]).map((x, i) => <li key={i}>{x.title}, {x.institution}{x.year ? ` (${x.year})` : ''}</li>)}</ul> : <p>—</p>}
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground">Subjects</p>
                <div className="mt-1 flex flex-wrap gap-1.5">{t.subjects.map((s: any) => <Badge key={s.subjectId} tone={s.isActive ? 'neutral' : 'warning'}>{s.subject.name} · {formatMoney(s.hourlyRateMinor)}/hr{s.isActive ? '' : ' (inactive)'}</Badge>)}</div>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground">Weekly availability ({t.timezone.replace(/_/g, ' ')})</p>
                {t.availability.length ? <p>{t.availability.map((a: any) => `${DAYS[a.dayOfWeek]} ${minutesToLabel(a.startMinute)}–${minutesToLabel(a.endMinute)}`).join(' · ')}</p> : <p>None set</p>}
              </div>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Recent bookings" action={<Button asChild size="sm" variant="ghost"><Link href={`/admin/bookings?teacherId=${id}`}>All</Link></Button>} />
            {t.recentBookings.length ? (
              <ul className="divide-y divide-border">
                {t.recentBookings.map((b: any) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0"><Link href={`/admin/bookings/${b.id}`} className="font-medium hover:underline">{b.subject.name} · {b.student.fullName}</Link><p className="text-[12.5px] text-muted-foreground">{formatDateTime(b.startAt, zone)}</p></div>
                    <StatusBadge status={b.status} label={STATUS_LABEL[b.status]} />
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-sm text-muted-foreground">No bookings yet.</p>}
          </Card>
          <Earnings teacherId={id} />
        </div>
      </div>

      <Dialog
        open={!!decision}
        onOpenChange={(o) => !o && setDecision(null)}
        title={decision === 'APPROVED' ? (t.approvalStatus === 'SUSPENDED' ? 'Reactivate this teacher?' : 'Approve this application?') : decision === 'REJECTED' ? 'Reject this application?' : 'Suspend this teacher?'}
        description={decision === 'APPROVED' ? 'The profile goes live and students can book. The teacher is emailed.' : decision === 'REJECTED' ? 'The teacher is emailed your reason and can resubmit.' : 'The profile is hidden from students. Review their upcoming bookings separately.'}
        footer={<><Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button><Button variant={decision === 'APPROVED' ? 'primary' : 'danger'} disabled={decision === 'REJECTED' && note.trim().length < 5} loading={decide.isPending} onClick={() => decide.mutate()}>Confirm</Button></>}
      >
        <Field label={decision === 'REJECTED' ? 'Reason (sent to the teacher)' : 'Internal note (audit log)'} htmlFor="detail-note">
          <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

function Documents({ teacherId, docs, onChange }: { teacherId: string; docs: any[]; onChange: () => void }) {
  const [reviewing, setReviewing] = useState<{ doc: any; status: 'VERIFIED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const review = useMutation({
    mutationFn: () => adminService.reviewDocument(teacherId, reviewing!.doc.id, reviewing!.status, note.trim() || undefined),
    onSuccess: () => { toast.success('Document reviewed'); setReviewing(null); setNote(''); onChange(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title="Qualification documents" description="Opening a document is recorded in the audit log." />
      {docs.length === 0 ? <div className="p-5"><EmptyState icon={<FileText />} title="No documents uploaded" /></div> : (
        <ul className="divide-y divide-border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-5 py-3 xl:flex-row xl:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="text-[12.5px] text-muted-foreground">{DOC_LABEL[d.type] ?? d.type} · {d.file.fileName} · {Math.max(1, Math.round(d.file.sizeBytes / 1024))} KB · {relative(d.createdAt)}</p>
                {d.reviewNote && <p className="text-[12.5px] text-muted-foreground">Note: {d.reviewNote}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={d.reviewStatus} label={d.reviewStatus === 'PENDING' ? 'Not reviewed' : undefined} />
                <Button asChild size="sm" variant="ghost"><a href={adminService.teacherDocumentUrl(teacherId, d.id)} aria-label={`Download ${d.title}`}><Download /></a></Button>
                {d.reviewStatus !== 'VERIFIED' && <Button size="sm" variant="secondary" onClick={() => setReviewing({ doc: d, status: 'VERIFIED' })}>Verify</Button>}
                {d.reviewStatus !== 'REJECTED' && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setReviewing({ doc: d, status: 'REJECTED' })}>Reject</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!reviewing}
        onOpenChange={(o) => !o && setReviewing(null)}
        title={`${reviewing?.status === 'VERIFIED' ? 'Verify' : 'Reject'} “${reviewing?.doc.title ?? ''}”?`}
        footer={<><Button variant="secondary" onClick={() => setReviewing(null)}>Cancel</Button><Button variant={reviewing?.status === 'VERIFIED' ? 'primary' : 'danger'} loading={review.isPending} onClick={() => review.mutate()}>Confirm</Button></>}
      >
        <Field label={reviewing?.status === 'REJECTED' ? 'Note for the teacher' : 'Note (optional)'} htmlFor="doc-note"><Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </Dialog>
    </Card>
  );
}

function Earnings({ teacherId }: { teacherId: string }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [rupees, setRupees] = useState('');
  const [desc, setDesc] = useState('');
  const q = useQuery({ queryKey: ['admin', 'teacher', teacherId, 'earnings', page], queryFn: () => adminService.teacherEarnings(teacherId, page), placeholderData: keepPreviousData });
  const amountMinor = Math.round(Number(rupees) * 100);
  const valid = /^-?\d+(\.\d{1,2})?$/.test(rupees.trim()) && amountMinor !== 0 && desc.trim().length >= 5;
  const adjust = useMutation({
    mutationFn: () => adminService.addAdjustment(teacherId, amountMinor, desc.trim()),
    onSuccess: () => { toast.success('Adjustment recorded'); setOpen(false); setRupees(''); setDesc(''); qc.invalidateQueries({ queryKey: ['admin', 'teacher', teacherId] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = q.data?.summary;
  return (
    <Card>
      <CardHeader title="Earnings" description={s ? `${formatMoney(s.availableMinor)} available · ${formatMoney(s.paidOutMinor)} paid out` : undefined} action={<Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Add adjustment</Button>} />
      {q.isError ? <div className="p-5"><ErrorState message={errorMessage(q.error)} /></div> : !q.data ? <Skeleton className="m-5 h-32" /> : q.data.ledger.data.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No earnings yet.</p> : (
        <div className="p-3">
          <Table className="border-0 shadow-none">
            <tbody>
              {q.data.ledger.data.map((e: any) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-[13px]">{formatDate(e.earnedAt, 'Asia/Kolkata')}</td>
                  <td className="text-[13px]">{e.type === 'ADJUSTMENT' ? `Adjustment: ${e.description}` : `${e.booking?.subject ?? ''} · ${e.booking?.student ?? ''}`}</td>
                  <td className={`text-right tabular-nums ${e.amountMinor < 0 ? 'text-danger' : ''}`}>{formatMoney(e.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={q.data.ledger.meta.page} totalPages={q.data.ledger.meta.totalPages} onPage={setPage} />
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Record an earnings adjustment"
        description="Adjustments are permanent ledger entries and are recorded in the audit log. Use a negative amount to deduct (for example, a refund agreed after the session)."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!valid} loading={adjust.isPending} onClick={() => adjust.mutate()}>Record {valid ? formatMoney(amountMinor) : ''}</Button></>}
      >
        <div className="space-y-4">
          <Field label="Amount in rupees" htmlFor="adj-amount" hint="e.g. 250 or -250.50"><Input inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} /></Field>
          <Field label="Reason" htmlFor="adj-desc" hint="Visible to the teacher in their ledger"><Input maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        </div>
      </Dialog>
    </Card>
  );
}
