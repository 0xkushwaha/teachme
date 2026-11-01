'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { Alert, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, StatusBadge, Table } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatMoney, relative } from '@/utils/format';

type Action = { payout: any; kind: 'approve' | 'paid' | 'reject' }; // eslint-disable-line @typescript-eslint/no-explicit-any

export default function AdminPayouts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('REQUESTED');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['admin', 'payouts', status, page], queryFn: () => adminService.payouts({ status: status === 'ALL' ? undefined : status, page }), placeholderData: keepPreviousData });
  const act = useMutation({
    mutationFn: () => {
      const id = action!.payout.id;
      if (action!.kind === 'approve') return adminService.approvePayout(id, text.trim() || undefined);
      if (action!.kind === 'paid') return adminService.markPayoutPaid(id, text.trim());
      return adminService.rejectPayout(id, text.trim());
    },
    onSuccess: () => { toast.success('Payout updated and teacher notified'); setAction(null); setText(''); qc.invalidateQueries({ queryKey: ['admin', 'payouts'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const total = (s: string) => q.data?.totals.find((t) => t.status === s);
  const textValid = action?.kind === 'approve' || (action?.kind === 'paid' ? text.trim().length >= 4 : text.trim().length >= 5);

  return (
    <>
      <PageHeader title="Teacher payouts" description="Teachers request payouts of their available balance. Approve, send the bank transfer outside TeachMe, then record the transfer reference." />
      <Alert tone="info" className="mb-6">TeachMe does not move money for payouts. “Mark paid” records a transfer you have already made, with its bank reference, for reconciliation.</Alert>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting approval" value={formatMoney(total('REQUESTED')?.amountMinor ?? 0)} hint={`${total('REQUESTED')?.count ?? 0} request(s)`} />
        <StatCard label="Approved, to be paid" value={formatMoney(total('APPROVED')?.amountMinor ?? 0)} hint={`${total('APPROVED')?.count ?? 0} payout(s)`} />
        <StatCard label="Paid out (all time)" value={formatMoney(total('PAID')?.amountMinor ?? 0)} hint={`${total('PAID')?.count ?? 0} payout(s)`} />
      </div>
      <Tabs className="mb-4" value={status} onValueChange={(v) => { setStatus(v); setPage(1); }} items={[{ value: 'REQUESTED', label: 'Requested' }, { value: 'APPROVED', label: 'Approved' }, { value: 'PAID', label: 'Paid' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: 'ALL', label: 'All' }]} />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-64 rounded-2xl" /> : q.data.data.length === 0 ? (
        <EmptyState icon={<HandCoins />} title="Nothing here" description={status === 'REQUESTED' ? 'No payout requests are waiting.' : undefined} />
      ) : (
        <>
          <Table>
            <thead><tr><th>Teacher</th><th className="text-right">Amount</th><th>Status</th><th>Requested</th><th>Details</th><th /></tr></thead>
            <tbody>
              {q.data.data.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/admin/teachers/${p.teacher.id}`} className="font-medium hover:underline">{p.teacher.user.fullName}</Link><p className="text-[12.5px] text-muted-foreground">{p.teacher.user.email}</p></td>
                  <td className="text-right font-medium tabular-nums">{formatMoney(p.amountMinor)}<p className="text-[12px] font-normal text-muted-foreground">{p._count.earnings} entries</p></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="whitespace-nowrap text-[13px]">{relative(p.requestedAt)}</td>
                  <td className="max-w-56 text-[13px] text-muted-foreground">{p.reference ? `Ref ${p.reference}` : p.rejectionReason ?? p.note ?? '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {p.status === 'REQUESTED' && <Button size="sm" onClick={() => setAction({ payout: p, kind: 'approve' })}>Approve</Button>}
                    {p.status === 'APPROVED' && <Button size="sm" onClick={() => setAction({ payout: p, kind: 'paid' })}>Mark paid</Button>}
                    {(p.status === 'REQUESTED' || p.status === 'APPROVED') && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setAction({ payout: p, kind: 'reject' })}>Reject</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(o) => { if (!o) { setAction(null); setText(''); } }}
        title={action ? `${action.kind === 'approve' ? 'Approve' : action.kind === 'paid' ? 'Record payment of' : 'Reject'} ${formatMoney(action.payout.amountMinor)} for ${action.payout.teacher.user.fullName}?` : ''}
        description={action?.kind === 'paid' ? 'Only do this after the bank transfer has been sent. This cannot be undone.' : action?.kind === 'reject' ? 'The amount returns to the teacher’s available balance and they see your reason.' : 'Approved payouts are queued for you to transfer and then mark as paid.'}
        footer={<><Button variant="secondary" onClick={() => setAction(null)}>Cancel</Button><Button variant={action?.kind === 'reject' ? 'danger' : 'primary'} disabled={!textValid} loading={act.isPending} onClick={() => act.mutate()}>Confirm</Button></>}
      >
        {action?.kind === 'paid' ? (
          <Field label="Bank transfer reference (UTR)" htmlFor="payout-ref"><Input maxLength={100} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        ) : (
          <Field label={action?.kind === 'reject' ? 'Reason (sent to the teacher)' : 'Note (optional)'} htmlFor="payout-text"><Textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        )}
      </Dialog>
    </>
  );
}
