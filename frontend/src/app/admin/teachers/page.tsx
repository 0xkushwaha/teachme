'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, MailPlus, RotateCw, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatusBadge, Table } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService, type Invitation } from '@/services/admin';
import { formatMoney, relative } from '@/utils/format';

const TEACHER_TABS = [
  { value: 'SUBMITTED', label: 'Awaiting review' },
  { value: 'DRAFT', label: 'Still applying' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'ALL', label: 'All' },
];

export default function AdminTeachers() {
  const [section, setSection] = useState<'teachers' | 'invitations'>('teachers');
  const [inviteOpen, setInviteOpen] = useState(false);
  return (
    <>
      <PageHeader
        title="Teachers"
        description="Invite teachers, review applications and documents, and manage live profiles."
        actions={<Button onClick={() => setInviteOpen(true)}><MailPlus />Invite teacher</Button>}
      />
      <Tabs className="mb-5" value={section} onValueChange={(v) => setSection(v as typeof section)} items={[{ value: 'teachers', label: 'Teachers & applications' }, { value: 'invitations', label: 'Invitations' }]} />
      {section === 'teachers' ? <TeacherList /> : <Invitations />}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onSent={() => setSection('invitations')} />
    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function TeacherList() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('SUBMITTED');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState<{ t: any; status: 'APPROVED' | 'REJECTED' | 'SUSPENDED' } | null>(null);
  const [note, setNote] = useState('');
  const filter = tab === 'SUBMITTED' ? { approvalStatus: 'PENDING', stage: 'submitted' } : tab === 'DRAFT' ? { approvalStatus: 'PENDING', stage: 'draft' } : tab === 'ALL' ? {} : { approvalStatus: tab };
  const q = useQuery({ queryKey: ['admin', 'teachers', tab, page, search], queryFn: () => adminService.teachers({ ...filter, page, q: search || undefined }), placeholderData: keepPreviousData });
  const decide = useMutation({
    mutationFn: () => adminService.setApproval(decision!.t.id, decision!.status, note.trim() || undefined),
    onSuccess: () => { toast.success('Teacher updated and notified'); setDecision(null); setNote(''); qc.invalidateQueries({ queryKey: ['admin', 'teachers'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const needsReason = decision?.status === 'REJECTED';
  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }} items={TEACHER_TABS} />
        <Input aria-label="Search teachers" placeholder="Search name or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="sm:max-w-xs" />
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : q.data?.data.length ? (
        <>
          <div className="space-y-3">
            {q.data.data.map((t: any) => {
              const complete = t.headline.length >= 10 && t.bio.length >= 50 && t.subjects.some((s: any) => s.isActive);
              const submitted = Boolean(t.applicationSubmittedAt);
              const reviewable = t.approvalStatus === 'PENDING' || t.approvalStatus === 'REJECTED';
              return (
                <Card key={t.id} className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <Avatar name={t.user.fullName} src={t.avatarUrl} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/teachers/${t.id}`} className="font-semibold hover:underline">{t.user.fullName}</Link>
                        <StatusBadge status={t.approvalStatus} />
                        {t.approvalStatus === 'PENDING' && <Badge tone={submitted ? 'accent' : 'neutral'}>{submitted ? `Submitted ${relative(t.applicationSubmittedAt)}` : 'Not submitted'}</Badge>}
                        {t.user.status !== 'ACTIVE' && <StatusBadge status={t.user.status} />}
                        {!complete && <Badge tone="warning">Profile incomplete</Badge>}
                      </div>
                      <p className="text-[13px] text-muted-foreground">{t.user.email} · joined {relative(t.createdAt)} · {t._count.bookings} bookings · {t._count.availability} weekly windows · <FileText className="inline size-3.5" aria-hidden /> {t._count.documents} document{t._count.documents === 1 ? '' : 's'}</p>
                      <p className="mt-2 text-sm">{t.headline || <span className="text-muted-foreground">No headline</span>}</p>
                      {t.bio && <p className="mt-1 line-clamp-2 text-[13.5px] text-muted-foreground">{t.bio}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">{t.subjects.filter((s: any) => s.isActive).map((s: any) => <Badge key={s.subjectId}>{s.subject.name} · {formatMoney(s.hourlyRateMinor)}/hr</Badge>)}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button asChild size="sm" variant="secondary"><Link href={`/admin/teachers/${t.id}`}>Review</Link></Button>
                      {t.approvalStatus === 'APPROVED' && <Button asChild size="sm" variant="ghost"><Link href={`/teachers/${t.slug}`} target="_blank"><ExternalLink />Profile</Link></Button>}
                      {(t.approvalStatus === 'SUSPENDED' || (reviewable && submitted)) && (
                        <Button size="sm" disabled={!complete} title={complete ? undefined : 'Needs headline, bio and a subject'} onClick={() => setDecision({ t, status: 'APPROVED' })}>{t.approvalStatus === 'SUSPENDED' ? 'Reactivate' : 'Approve'}</Button>
                      )}
                      {t.approvalStatus === 'PENDING' && submitted && <Button size="sm" variant="secondary" onClick={() => setDecision({ t, status: 'REJECTED' })}>Reject</Button>}
                      {t.approvalStatus === 'APPROVED' && <Button size="sm" variant="secondary" className="text-danger" onClick={() => setDecision({ t, status: 'SUSPENDED' })}>Suspend</Button>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState title={tab === 'SUBMITTED' ? 'No applications waiting for review' : 'No teachers here'} description={tab === 'SUBMITTED' ? 'Teachers appear here after they submit their application.' : undefined} />}
      <Dialog
        open={!!decision}
        onOpenChange={(o) => !o && setDecision(null)}
        title={`${decision?.status === 'APPROVED' ? (decision.t.approvalStatus === 'SUSPENDED' ? 'Reactivate' : 'Approve') : decision?.status === 'REJECTED' ? 'Reject' : 'Suspend'} ${decision?.t.user.fullName ?? ''}?`}
        description={decision?.status === 'APPROVED' ? 'Their profile goes live and students can book them. They are notified by email.' : decision?.status === 'REJECTED' ? 'The teacher sees your reason and can update their application and resubmit.' : 'Their profile is hidden from students. Existing confirmed bookings remain and should be reviewed.'}
        footer={<><Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button><Button variant={decision?.status === 'APPROVED' ? 'primary' : 'danger'} disabled={needsReason && note.trim().length < 5} loading={decide.isPending} onClick={() => decide.mutate()}>Confirm</Button></>}
      >
        <Field label={needsReason ? 'Reason (sent to the teacher)' : 'Internal note (audit log)'} htmlFor="decision-note" hint={needsReason ? 'At least 5 characters. Be specific about what to change.' : undefined}>
          <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}

function Invitations() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const q = useQuery({ queryKey: ['admin', 'invitations', status, page, search], queryFn: () => adminService.invitations({ status: status === 'ALL' ? undefined : status, page, q: search || undefined }), placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'invitations'] });
  const resend = useMutation({ mutationFn: (id: string) => adminService.resendInvitation(id), onSuccess: () => { toast.success('Invitation re-sent with a new link'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const revoke = useMutation({ mutationFn: (id: string) => adminService.revokeInvitation(id), onSuccess: () => { toast.success('Invitation revoked'); setRevoking(null); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(v) => { setStatus(v); setPage(1); }} items={[{ value: 'PENDING', label: 'Pending' }, { value: 'ACCEPTED', label: 'Accepted' }, { value: 'EXPIRED', label: 'Expired' }, { value: 'REVOKED', label: 'Revoked' }, { value: 'ALL', label: 'All' }]} />
        <Input aria-label="Search invitations" placeholder="Search email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="sm:max-w-xs" />
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-64 rounded-2xl" /> : q.data.data.length === 0 ? (
        <EmptyState icon={<Send />} title="No invitations here" description="Invite a teacher by email. They get a single-use link that expires." />
      ) : (
        <>
          <Table>
            <thead><tr><th>Email</th><th>Status</th><th>Sent</th><th>Expires</th><th>Delivery</th><th /></tr></thead>
            <tbody>
              {q.data.data.map((i) => (
                <tr key={i.id}>
                  <td><p className="font-medium">{i.email}</p>{i.note && <p className="text-[12.5px] text-muted-foreground">{i.note}</p>}</td>
                  <td><StatusBadge status={i.status} /></td>
                  <td className="whitespace-nowrap text-[13px]">{relative(i.lastSentAt)}{i.sendCount > 1 ? ` · ${i.sendCount}×` : ''}</td>
                  <td className="whitespace-nowrap text-[13px]">{i.status === 'ACCEPTED' ? `Accepted ${i.acceptedAt ? relative(i.acceptedAt) : ''}` : relative(i.expiresAt)}</td>
                  <td className="text-[13px]">{i.lastDeliveryError ? <span className="text-danger" title={i.lastDeliveryError}>Failed</span> : i.deliveredAt ? 'Delivered' : i.status === 'PENDING' ? 'Queued' : '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {(i.status === 'PENDING' || i.status === 'EXPIRED') && (
                      <>
                        <Button size="sm" variant="ghost" loading={resend.isPending && resend.variables === i.id} onClick={() => resend.mutate(i.id)}><RotateCw />Resend</Button>
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRevoking(i)}><XCircle />Revoke</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      )}
      <Dialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Revoke the invitation for ${revoking?.email ?? ''}?`}
        description="The link stops working immediately. You can invite this address again later."
        footer={<><Button variant="secondary" onClick={() => setRevoking(null)}>Keep it</Button><Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)}>Revoke</Button></>}
      />
    </>
  );
}

function InviteDialog({ open, onOpenChange, onSent }: { open: boolean; onOpenChange: (o: boolean) => void; onSent: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const invite = useMutation({
    mutationFn: () => adminService.invite(email.trim().toLowerCase(), note.trim() || undefined),
    onSuccess: (i) => {
      toast.success(`Invitation sent to ${i.email}`);
      setEmail('');
      setNote('');
      onOpenChange(false);
      onSent();
      qc.invalidateQueries({ queryKey: ['admin', 'invitations'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a teacher"
      description="They receive a single-use link to create a teacher account. Their application still needs your approval before students can book them."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!valid} loading={invite.isPending} onClick={() => invite.mutate()}><Send />Send invitation</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) invite.mutate(); }}>
        <Field label="Email address" htmlFor="invite-email"><Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teacher@example.com" /></Field>
        <Field label="Internal note (optional)" htmlFor="invite-note" hint="Only visible to administrators"><Input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </form>
    </Dialog>
  );
}
