'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Hourglass, IndianRupee, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { Alert, Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatCard, StatusBadge, Table } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { teacherService } from '@/services/teacher';
import { browserTimezone, formatDate, formatMoney } from '@/utils/format';

const axis = { stroke: 'var(--muted-foreground)', fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--foreground)' };

export default function TeacherEarnings() {
  const qc = useQueryClient();
  const zone = browserTimezone();
  const [granularity, setGranularity] = useState<'weekly' | 'monthly'>('weekly');
  const [ledgerPage, setLedgerPage] = useState(1);
  const [payoutPage, setPayoutPage] = useState(1);
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState('');
  const summary = useQuery({ queryKey: ['teacher', 'earnings'], queryFn: teacherService.earnings });
  const series = useQuery({ queryKey: ['teacher', 'earnings', 'series'], queryFn: teacherService.earningsSeries });
  const ledger = useQuery({ queryKey: ['teacher', 'ledger', ledgerPage], queryFn: () => teacherService.ledger(ledgerPage), placeholderData: keepPreviousData });
  const payouts = useQuery({ queryKey: ['teacher', 'payouts', payoutPage], queryFn: () => teacherService.payouts(payoutPage), placeholderData: keepPreviousData });
  const refresh = () => ['earnings', 'ledger', 'payouts'].forEach((k) => qc.invalidateQueries({ queryKey: ['teacher', k] }));
  const request = useMutation({
    mutationFn: () => teacherService.requestPayout(note.trim() || undefined),
    onSuccess: () => { toast.success('Payout requested. You’ll get an email when it’s processed.'); setRequesting(false); setNote(''); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => teacherService.cancelPayout(id),
    onSuccess: () => { toast.success('Payout request cancelled'); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (summary.isError) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  const data = series.data?.[granularity] ?? [];

  return (
    <>
      <PageHeader
        title="Earnings & payouts"
        description="You earn your session price for every completed, paid session. Platform fees and tax are paid by students on top."
        actions={s?.payouts.enabled && <Button onClick={() => setRequesting(true)} disabled={!s.payouts.canRequest}><Wallet />Request payout</Button>}
      />
      {!s ? <Skeleton className="h-96 rounded-2xl" /> : (
        <div className="space-y-6">
          {s.payouts.open && (
            <Alert tone="info" title={`Payout of ${formatMoney(s.payouts.open.amountMinor)} is ${s.payouts.open.status.toLowerCase()}`}>
              Requested {formatDate(s.payouts.open.requestedAt, zone)}. Payouts are sent by bank transfer after an administrator approves them.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Available to withdraw" value={formatMoney(s.availableMinor)} hint={s.clearingMinor ? `${formatMoney(s.clearingMinor)} clearing (${s.payouts.clearingDays}-day hold)` : `Minimum payout ${formatMoney(s.payouts.minPayoutMinor)}`} icon={<Wallet />} />
            <StatCard label="Pending from upcoming sessions" value={formatMoney(s.pendingFromUpcomingMinor)} hint={`${s.sessions.upcoming} confirmed session${s.sessions.upcoming === 1 ? '' : 's'}`} icon={<CalendarClock />} />
            <StatCard label="This month" value={formatMoney(s.thisMonthMinor)} hint={`Last month ${formatMoney(s.lastMonthMinor)}`} icon={<IndianRupee />} />
            <StatCard label="Total earned" value={formatMoney(s.lifetimeMinor)} hint={`${formatMoney(s.paidOutMinor)} paid out${s.inPayoutMinor ? ` · ${formatMoney(s.inPayoutMinor)} in progress` : ''}`} icon={<CheckCircle2 />} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
            <Card>
              <CardHeader
                title="Earnings over time"
                description={series.data ? `Completed sessions, in ${series.data.timezone.replace(/_/g, ' ')}` : undefined}
                action={<Tabs value={granularity} onValueChange={(v) => setGranularity(v as 'weekly' | 'monthly')} items={[{ value: 'weekly', label: '12 weeks' }, { value: 'monthly', label: '12 months' }]} />}
              />
              <div className="h-72 p-4">
                {series.isError ? <ErrorState message={errorMessage(series.error)} /> : !series.data ? <Skeleton className="h-full" /> : data.every((d) => d.earningsMinor === 0) ? (
                  <p className="grid h-full place-items-center text-center text-sm text-muted-foreground">No completed sessions in this period yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.map((d) => ({ ...d, rupees: d.earningsMinor / 100 }))} margin={{ left: -10, right: 8, top: 8 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="period" {...axis} tickFormatter={(v: string) => (granularity === 'weekly' ? v.slice(5) : v.slice(0, 7))} />
                      <YAxis {...axis} tickFormatter={(v: number) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number, _n, item) => [`${formatMoney(Math.round(v * 100))} · ${item.payload.sessions} session${item.payload.sessions === 1 ? '' : 's'}`, 'Earned']} labelFormatter={(l: string) => (granularity === 'weekly' ? `Week of ${l}` : l.slice(0, 7))} />
                      <Bar dataKey="rupees" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Sessions" description="All time" />
              <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
                <div><dt className="text-muted-foreground">Completed</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{s.sessions.completed}</dd></div>
                <div><dt className="text-muted-foreground">Upcoming</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{s.sessions.upcoming}</dd></div>
                <div><dt className="text-muted-foreground">Cancelled</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{s.sessions.cancelled}</dd></div>
                <div><dt className="text-muted-foreground">Cancellation rate (90 days)</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{s.sessions.cancellationRate90d}%</dd></div>
              </dl>
            </Card>
          </div>

          <section aria-labelledby="ledger-h">
            <h2 id="ledger-h" className="mb-3 text-[15px] font-semibold">Earnings history</h2>
            {ledger.isError ? <ErrorState message={errorMessage(ledger.error)} onRetry={() => ledger.refetch()} /> : !ledger.data ? <Skeleton className="h-48 rounded-2xl" /> : ledger.data.data.length === 0 ? (
              <EmptyState icon={<Hourglass />} title="No earnings yet" description="Earnings appear here when a paid session is completed. You can mark a session completed from its booking page once it has ended." />
            ) : (
              <>
                <Table>
                  <thead><tr><th>Date</th><th>Description</th><th>Student</th><th className="text-right">Amount</th><th>Payout</th></tr></thead>
                  <tbody>
                    {ledger.data.data.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap">{formatDate(e.earnedAt, zone)}</td>
                        <td>{e.type === 'ADJUSTMENT' ? <span>{e.description} <StatusBadge status="ADJUSTMENT" label="Adjustment" /></span> : `${e.booking?.subject ?? e.description} · ${e.booking?.durationMinutes ?? ''} min`}</td>
                        <td>{e.booking?.student ?? '—'}</td>
                        <td className={`text-right tabular-nums ${e.amountMinor < 0 ? 'text-danger' : ''}`}>{formatMoney(e.amountMinor)}</td>
                        <td>{e.payout ? <StatusBadge status={e.payout.status} /> : <span className="text-[13px] text-muted-foreground">Not paid out</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={ledger.data.meta.page} totalPages={ledger.data.meta.totalPages} onPage={setLedgerPage} />
              </>
            )}
          </section>

          <section aria-labelledby="payouts-h">
            <h2 id="payouts-h" className="mb-3 text-[15px] font-semibold">Payout history</h2>
            {payouts.isError ? <ErrorState message={errorMessage(payouts.error)} onRetry={() => payouts.refetch()} /> : !payouts.data ? <Skeleton className="h-32 rounded-2xl" /> : payouts.data.data.length === 0 ? (
              <EmptyState icon={<Wallet />} title="No payouts yet" description={`Request a payout once your available balance reaches ${formatMoney(s.payouts.minPayoutMinor)}.`} />
            ) : (
              <>
                <Table>
                  <thead><tr><th>Requested</th><th className="text-right">Amount</th><th>Status</th><th>Reference / note</th><th /></tr></thead>
                  <tbody>
                    {payouts.data.data.map((p) => (
                      <tr key={p.id}>
                        <td className="whitespace-nowrap">{formatDate(p.requestedAt, zone)}</td>
                        <td className="text-right tabular-nums">{formatMoney(p.amountMinor)}</td>
                        <td><StatusBadge status={p.status} /></td>
                        <td className="text-[13px] text-muted-foreground">{p.status === 'PAID' ? `Paid ${p.paidAt ? formatDate(p.paidAt, zone) : ''} · ref ${p.reference}` : p.rejectionReason ?? p.note ?? '—'}</td>
                        <td className="text-right">{p.status === 'REQUESTED' && <Button size="sm" variant="ghost" loading={cancel.isPending && cancel.variables === p.id} onClick={() => cancel.mutate(p.id)}>Cancel</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={payouts.data.meta.page} totalPages={payouts.data.meta.totalPages} onPage={setPayoutPage} />
              </>
            )}
          </section>
        </div>
      )}

      <Dialog
        open={requesting}
        onOpenChange={setRequesting}
        title={`Request a payout of ${formatMoney(s?.availableMinor ?? 0)}?`}
        description="Your whole available balance is included. An administrator approves the request and sends it by bank transfer to the account on file with TeachMe support."
        footer={<><Button variant="secondary" onClick={() => setRequesting(false)}>Cancel</Button><Button loading={request.isPending} onClick={() => request.mutate()}>Request payout</Button></>}
      >
        <Textarea aria-label="Note for the payments team (optional)" placeholder="Note for the payments team (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Dialog>
    </>
  );
}
