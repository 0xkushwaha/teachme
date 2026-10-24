'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { Avatar, Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatMoney, relative } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AdminTeachers() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState<{ t: any; status: string } | null>(null);
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['admin', 'teachers', tab, page, search], queryFn: () => adminService.teachers({ approvalStatus: tab === 'ALL' ? undefined : tab, page, q: search || undefined }), placeholderData: keepPreviousData });
  const decide = useMutation({
    mutationFn: () => adminService.setApproval(decision!.t.id, decision!.status, note || undefined),
    onSuccess: () => { toast.success('Teacher updated and notified'); setDecision(null); setNote(''); qc.invalidateQueries({ queryKey: ['admin', 'teachers'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Teachers" description="Review applications, and approve, suspend or reject teacher profiles." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }} items={[{ value: 'PENDING', label: 'Pending review' }, { value: 'APPROVED', label: 'Approved' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'ALL', label: 'All' }]} />
        <Input aria-label="Search teachers" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
      </div>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : q.data?.data.length ? (
        <>
          <div className="space-y-3">
            {q.data.data.map((t: any) => {
              const complete = t.headline.length >= 10 && t.bio.length >= 50 && t.subjects.length > 0;
              return (
                <Card key={t.id} className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <Avatar name={t.user.fullName} src={t.avatarUrl} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{t.user.fullName}</p><StatusBadge status={t.approvalStatus} />{t.user.status !== 'ACTIVE' && <StatusBadge status={t.user.status} />}{!complete && <Badge tone="warning">Profile incomplete</Badge>}</div>
                      <p className="text-[13px] text-muted-foreground">{t.user.email} · applied {relative(t.createdAt)} · {t._count.bookings} bookings · {t._count.availability} weekly windows</p>
                      <p className="mt-2 text-sm">{t.headline || <span className="text-muted-foreground">No headline</span>}</p>
                      {t.bio && <p className="mt-1 line-clamp-3 text-[13.5px] text-muted-foreground">{t.bio}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">{t.subjects.map((s: any) => <Badge key={s.subjectId}>{s.subject.name} · {formatMoney(s.hourlyRateMinor)}/hr</Badge>)}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {t.approvalStatus === 'APPROVED' && <Button asChild size="sm" variant="ghost"><Link href={`/teachers/${t.slug}`} target="_blank"><ExternalLink />Profile</Link></Button>}
                      {t.approvalStatus !== 'APPROVED' && <Button size="sm" disabled={!complete} title={complete ? undefined : 'Needs headline, bio and a subject'} onClick={() => setDecision({ t, status: 'APPROVED' })}>Approve</Button>}
                      {t.approvalStatus === 'PENDING' && <Button size="sm" variant="secondary" onClick={() => setDecision({ t, status: 'REJECTED' })}>Reject</Button>}
                      {t.approvalStatus === 'APPROVED' && <Button size="sm" variant="secondary" className="text-danger" onClick={() => setDecision({ t, status: 'SUSPENDED' })}>Suspend</Button>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState title={tab === 'PENDING' ? 'No applications waiting' : 'No teachers here'} />}
      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)} title={`${decision?.status === 'APPROVED' ? 'Approve' : decision?.status === 'REJECTED' ? 'Reject' : 'Suspend'} ${decision?.t.user.fullName ?? ''}?`} description={decision?.status === 'APPROVED' ? 'Their profile goes live and students can book them.' : 'Their profile is hidden from students. Existing confirmed bookings remain and should be reviewed.'}
        footer={<><Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button><Button variant={decision?.status === 'APPROVED' ? 'primary' : 'danger'} loading={decide.isPending} onClick={() => decide.mutate()}>Confirm</Button></>}>
        <Input aria-label="Internal note" placeholder="Internal note (audit log)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Dialog>
    </>
  );
}
