'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatusBadge, Table } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatDateTime, formatMoney } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
function Payments() {
  const params = useSearchParams();
  const { timezone } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState(params.get('discrepancy') ? 'discrepancies' : 'payments');
  const [page, setPage] = useState(1);
  const [resolving, setResolving] = useState<any>(null);
  const [note, setNote] = useState('');
  const payments = useQuery({ queryKey: ['admin', 'payments', tab, page], queryFn: () => adminService.payments({ page, discrepancy: tab === 'discrepancies' ? 'true' : undefined, status: tab === 'failed' ? 'FAILED' : undefined }), enabled: tab !== 'refunds', placeholderData: keepPreviousData });
  const refunds = useQuery({ queryKey: ['admin', 'refunds', page], queryFn: () => adminService.refunds({ page }), enabled: tab === 'refunds', placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const reconcile = useMutation({ mutationFn: adminService.reconcile, onSuccess: (r) => { toast.success(`Reconciled: ${r.outcome}`); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const resolve = useMutation({ mutationFn: () => adminService.resolve(resolving.id, note), onSuccess: () => { toast.success('Marked resolved'); setResolving(null); setNote(''); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const retryRefund = useMutation({ mutationFn: adminService.retryRefund, onSuccess: () => { toast.success('Refund re-queued'); refresh(); }, onError: (e) => toast.error(errorMessage(e)) });
  const active = tab === 'refunds' ? refunds : payments;
  return (
    <>
      <PageHeader title="Payments & refunds" description="Payment states come from Razorpay via verified callbacks, webhooks and reconciliation." />
      <Tabs className="mb-4" value={tab} onValueChange={(v) => { setTab(v); setPage(1); }} items={[{ value: 'payments', label: 'All payments' }, { value: 'discrepancies', label: 'Discrepancies' }, { value: 'failed', label: 'Failed' }, { value: 'refunds', label: 'Refunds' }]} />
      {active.isError ? <ErrorState message={errorMessage(active.error)} onRetry={() => active.refetch()} /> : active.isLoading ? <Skeleton className="h-96 rounded-2xl" /> : tab === 'refunds' ? (
        refunds.data?.data.length ? (
          <>
            <Table>
              <thead><tr><th>Refund</th><th>Amount</th><th>Status</th><th>Reason</th><th>Created</th><th /></tr></thead>
              <tbody>{refunds.data.data.map((r: any) => (
                <tr key={r.id}>
                  <td><Link href={`/admin/bookings/${r.bookingId}`} className="font-mono text-[12px] hover:text-accent">{r.providerRefundId ?? r.id.slice(0, 8)}</Link></td>
                  <td className="tabular-nums">{formatMoney(r.amountMinor)}</td>
                  <td><StatusBadge status={r.status} />{r.failureReason && <p className="text-[11px] text-danger">{r.failureReason}</p>}</td>
                  <td className="max-w-xs truncate text-[13px] text-muted-foreground">{r.reason}</td>
                  <td className="text-[13px]">{formatDateTime(r.createdAt, timezone)}</td>
                  <td className="text-right">{r.status !== 'PROCESSED' && <Button size="sm" variant="ghost" onClick={() => retryRefund.mutate(r.id)}>Retry</Button>}</td>
                </tr>))}
              </tbody>
            </Table>
            <Pagination page={refunds.data.meta.page} totalPages={refunds.data.meta.totalPages} onPage={setPage} />
          </>
        ) : <EmptyState title="No refunds" />
      ) : payments.data?.data.length ? (
        <>
          <Table>
            <thead><tr><th>Order / payment</th><th>Student</th><th>Amount</th><th>Status</th><th>Booking</th><th>Created</th><th /></tr></thead>
            <tbody>{payments.data.data.map((p: any) => (
              <tr key={p.id}>
                <td><p className="font-mono text-[12px]">{p.providerOrderId}</p><p className="font-mono text-[11px] text-muted-foreground">{p.providerPaymentId ?? '—'}</p>{p.discrepancy && <p className="mt-1 text-[11px] text-danger">{p.discrepancy}{p.discrepancyResolvedAt ? ' (resolved)' : ''}</p>}</td>
                <td className="text-[13px]">{p.booking.student.fullName}</td>
                <td className="tabular-nums">{formatMoney(p.amountMinor, p.currency)}{p.refundedMinor > 0 && <p className="text-[11px] text-muted-foreground">−{formatMoney(p.refundedMinor)} refunded</p>}</td>
                <td><StatusBadge status={p.status} />{p.failureReason && <p className="text-[11px] text-muted-foreground">{p.failureReason}</p>}</td>
                <td><Link href={`/admin/bookings/${p.booking.id}`} className="hover:text-accent"><StatusBadge status={p.booking.status} /></Link></td>
                <td className="whitespace-nowrap text-[13px]">{formatDateTime(p.createdAt, timezone)}</td>
                <td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" loading={reconcile.isPending && reconcile.variables === p.id} onClick={() => reconcile.mutate(p.id)}>Reconcile</Button>
                  {p.discrepancy && !p.discrepancyResolvedAt && <Button size="sm" variant="ghost" onClick={() => setResolving(p)}>Resolve</Button>}
                </td>
              </tr>))}
            </tbody>
          </Table>
          <Pagination page={payments.data.meta.page} totalPages={payments.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState title={tab === 'discrepancies' ? 'No open discrepancies' : 'No payments'} />}
      <Dialog open={!!resolving} onOpenChange={(o) => !o && setResolving(null)} title="Mark discrepancy resolved" description={resolving?.discrepancy}
        footer={<><Button variant="secondary" onClick={() => setResolving(null)}>Cancel</Button><Button disabled={note.trim().length < 3} loading={resolve.isPending} onClick={() => resolve.mutate()}>Resolve</Button></>}>
        <Input aria-label="Resolution note" placeholder="What was done? (audit log)" value={note} onChange={(e) => setNote(e.target.value)} />
      </Dialog>
    </>
  );
}

export default function Page() {
  return <Suspense><Payments /></Suspense>;
}
