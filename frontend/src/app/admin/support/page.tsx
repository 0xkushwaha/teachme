'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatDateTime } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function SupportTickets() {
  const { timezone } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('OPEN');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<any>(null);
  const [status, setStatus] = useState('IN_PROGRESS');
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['admin', 'tickets', tab, page], queryFn: () => adminService.tickets({ status: tab === 'ALL' ? undefined : tab, page }), placeholderData: keepPreviousData });
  const update = useMutation({ mutationFn: () => adminService.updateTicket(open.id, status, note || undefined), onSuccess: () => { toast.success('Ticket updated'); setOpen(null); qc.invalidateQueries({ queryKey: ['admin', 'tickets'] }); }, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <>
      <PageHeader title="Support tickets" description="Contact-form messages and booking issue reports. Reply to the customer by email." />
      <Tabs className="mb-4" value={tab} onValueChange={(v) => { setTab(v); setPage(1); }} items={[{ value: 'OPEN', label: 'Open' }, { value: 'IN_PROGRESS', label: 'In progress' }, { value: 'RESOLVED', label: 'Resolved' }, { value: 'ALL', label: 'All' }]} />
      {q.isError ? <ErrorState message={errorMessage(q.error)} /> : q.isLoading ? <Skeleton className="h-80 rounded-2xl" /> : q.data?.data.length ? (
        <>
          <div className="space-y-3">
            {q.data.data.map((t: any) => (
              <Card key={t.id} className="p-5">
                <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{t.subject}</p><StatusBadge status={t.status} /><Badge>{t.category.replace(/_/g, ' ').toLowerCase()}</Badge></div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{t.name} · <a className="text-accent" href={`mailto:${t.email}`}>{t.email}</a> · {formatDateTime(t.createdAt, timezone)}{t.bookingId && <> · <Link className="text-accent" href={`/admin/bookings/${t.bookingId}`}>booking</Link></>}</p>
                <p className="mt-3 whitespace-pre-line text-sm">{t.message}</p>
                {t.adminNote && <p className="mt-3 rounded-lg bg-surface-2 p-3 text-[13px] text-muted-foreground">Note: {t.adminNote}</p>}
                <Button size="sm" variant="secondary" className="mt-4" onClick={() => { setOpen(t); setStatus(t.status === 'OPEN' ? 'IN_PROGRESS' : t.status); setNote(t.adminNote ?? ''); }}>Update</Button>
              </Card>
            ))}
          </div>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState title="No tickets here" />}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Update ticket" footer={<><Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button><Button loading={update.isPending} onClick={() => update.mutate()}>Save</Button></>}>
        <div className="space-y-3">
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></Select>
          <Textarea aria-label="Internal note" placeholder="Internal note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Dialog>
    </>
  );
}
