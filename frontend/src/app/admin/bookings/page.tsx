'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatusBadge, Table } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatDateTime, formatMoney, STATUS_LABEL } from '@/utils/format';

export default function AdminBookings() {
  const { timezone } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['admin', 'bookings', status, page], queryFn: () => adminService.bookings({ status: status || undefined, page }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Bookings" description="Every booking across the platform, newest first." actions={
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-52">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      } />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-96 rounded-2xl" /> : q.data?.data.length ? (
        <>
          <Table>
            <thead><tr><th>Session</th><th>When</th><th>Status</th><th>Payment</th><th>Meet</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {q.data.data.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`/admin/bookings/${b.id}`} className="font-medium hover:text-accent">{b.subject.name}</Link><p className="text-[12px] text-muted-foreground">{b.student.name} → {b.teacher.name}</p></td>
                  <td className="whitespace-nowrap text-[13px]">{formatDateTime(b.startAt, timezone)}</td>
                  <td><StatusBadge status={b.status} label={STATUS_LABEL[b.status]} /></td>
                  <td>{b.payment ? <StatusBadge status={b.payment.status} /> : <span className="text-muted-foreground">—</span>}{b.payment?.discrepancy && <p className="mt-1 text-[11px] text-danger">Discrepancy</p>}</td>
                  <td>{b.meeting ? <StatusBadge status={b.meeting.status} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-right tabular-nums">{formatMoney(b.price.totalMinor, b.price.currency)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState title="No bookings" />}
    </>
  );
}
