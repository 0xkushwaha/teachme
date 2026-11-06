'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard, Table } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatMoney } from '@/utils/format';

const today = () => DateTime.now().toISODate()!;

export default function AdminFinance() {
  const [from, setFrom] = useState(() => DateTime.now().minus({ days: 30 }).toISODate()!);
  const [to, setTo] = useState(today);
  // Inclusive end date in the admin's timezone, sent as ISO instants.
  const fromIso = DateTime.fromISO(from).startOf('day').toISO()!;
  const toIso = DateTime.fromISO(to).plus({ days: 1 }).startOf('day').toISO()!;
  const valid = from <= to;
  const q = useQuery({ queryKey: ['admin', 'finance', fromIso, toIso], queryFn: () => adminService.finance(fromIso, toIso), enabled: valid, placeholderData: keepPreviousData });
  const d = q.data;
  return (
    <>
      <PageHeader
        title="Finance reports"
        description="Money collected from students, refunds, platform revenue and what is owed to teachers."
        actions={<Button asChild variant="secondary" disabled={!valid}><a href={adminService.financeCsvUrl(fromIso, toIso)}><Download />Export CSV</a></Button>}
      />
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="From" htmlFor="fin-from"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" htmlFor="fin-to"><Input type="date" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} /></Field>
          {[7, 30, 90, 365].map((n) => (
            <Button key={n} size="sm" variant="ghost" onClick={() => { setFrom(DateTime.now().minus({ days: n }).toISODate()!); setTo(today()); }}>Last {n} days</Button>
          ))}
        </div>
        {!valid && <p className="mt-2 text-[13px] text-danger">The start date must be before the end date.</p>}
      </Card>
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-96 rounded-2xl" /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Collected" value={formatMoney(d.collectedMinor)} hint={`${d.payments} payments`} />
            <StatCard label="Refunded" value={formatMoney(d.refundedMinor)} hint={`${d.refunds} processed refunds`} />
            <StatCard label="Net collected" value={formatMoney(d.netCollectedMinor)} />
            <StatCard label="Platform fees" value={formatMoney(d.platformFeeMinor)} hint={`plus ${formatMoney(d.taxMinor)} tax collected`} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Topper earnings accrued" value={formatMoney(d.teacherEarningsMinor)} hint="Completed sessions in range" />
            <StatCard label="Payouts paid" value={formatMoney(d.payoutsPaidMinor)} hint={`${d.payoutsPaid} transfers in range`} />
            <StatCard label="Owed to toppers now" value={formatMoney(d.outstandingTeacherBalanceMinor)} hint="All unpaid earnings, today" />
            <StatCard label="Open payout requests" value={formatMoney(d.openPayouts.amountMinor)} hint={<Link href="/admin/payouts" className="underline underline-offset-4">{d.openPayouts.count} to process</Link>} />
          </div>
          <Card>
            <CardHeader title="Top toppers by earnings" description="In the selected range" />
            {d.topTeachers.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No completed, paid sessions in this range.</p> : (
              <div className="p-3">
                <Table className="border-0 shadow-none">
                  <thead><tr><th>Topper</th><th className="text-right">Sessions</th><th className="text-right">Earned</th></tr></thead>
                  <tbody>
                    {d.topTeachers.map((t) => (
                      <tr key={t.teacherId}><td><Link href={`/admin/teachers/${t.teacherId}`} className="hover:underline">{t.name}</Link></td><td className="text-right tabular-nums">{t.sessions}</td><td className="text-right tabular-nums">{formatMoney(t.earnedMinor)}</td></tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Card>
          <p className="text-[12.5px] text-muted-foreground">Collected and fees count payments captured in the range. Topper earnings are recognised when a paid session completes; each topper earns their session price, reduced pro rata by any refund. The CSV export lists every paid booking in the range (up to 50,000 rows).</p>
        </div>
      )}
    </>
  );
}
