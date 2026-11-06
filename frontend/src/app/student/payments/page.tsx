'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatusBadge, Table } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { studentPaymentService } from '@/services/account';
import { formatDate, formatDateTime, formatMoney } from '@/utils/format';

export default function StudentPayments() {
  const { timezone } = useAuth();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['student', 'payments', page], queryFn: () => studentPaymentService.list(page), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Payments & receipts" description="Every payment for your sessions, with refunds and downloadable receipts." />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-64 rounded-2xl" /> : q.data.data.length === 0 ? (
        <EmptyState icon={<Receipt />} title="No payments yet" description="Payments appear here after you book and pay for a session." action={<Button asChild><Link href="/student/find">Find a topper</Link></Button>} />
      ) : (
        <>
          <Table>
            <thead><tr><th>Date</th><th>Session</th><th className="text-right">Amount</th><th>Status</th><th /></tr></thead>
            <tbody>
              {q.data.data.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap">{formatDate(p.capturedAt ?? p.createdAt, timezone)}</td>
                  <td>
                    <Link href={`/student/sessions/${p.booking.id}`} className="font-medium hover:underline">{p.booking.subject} with {p.booking.teacher}</Link>
                    <p className="text-[12.5px] text-muted-foreground">{formatDateTime(p.booking.startAt, timezone)} · {p.booking.durationMinutes} min</p>
                  </td>
                  <td className="text-right tabular-nums">
                    {formatMoney(p.amountMinor, p.currency)}
                    {p.refundedMinor > 0 && <p className="text-[12.5px] text-muted-foreground">−{formatMoney(p.refundedMinor, p.currency)} refunded</p>}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                    {p.status === 'FAILED' && p.failureReason && <p className="mt-0.5 text-[12px] text-muted-foreground">{p.failureReason}</p>}
                  </td>
                  <td className="text-right">{p.status !== 'FAILED' && <Button asChild size="sm" variant="ghost"><Link href={`/student/payments/${p.id}`}><Receipt />Receipt</Link></Button>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      )}
    </>
  );
}
