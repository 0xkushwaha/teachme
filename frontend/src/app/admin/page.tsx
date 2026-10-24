'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck2, IndianRupee, Percent, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Tabs } from '@/components/ui/overlay';
import { Alert, Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatMoney } from '@/utils/format';

const axis = { stroke: 'var(--muted-foreground)', fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--foreground)' };

export default function AdminOverview() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['admin', 'overview', days], queryFn: () => adminService.overview(Number(days)), placeholderData: (p) => p });
  const d = q.data;
  return (
    <>
      <PageHeader title="Platform overview" actions={<Tabs value={days} onValueChange={setDays} items={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]} />} />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : !d ? <Skeleton className="h-96 rounded-2xl" /> : (
        <div className="space-y-6">
          {(d.ops.failedJobs > 0 || d.ops.openDiscrepancies > 0) && (
            <Alert tone="warning" title="Needs attention">
              {d.ops.failedJobs > 0 && <><Link className="underline" href="/admin/integrations">{d.ops.failedJobs} failed background job(s)</Link>. </>}
              {d.ops.openDiscrepancies > 0 && <Link className="underline" href="/admin/payments?discrepancy=true">{d.ops.openDiscrepancies} unresolved payment discrepanc{d.ops.openDiscrepancies === 1 ? 'y' : 'ies'}</Link>}
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Gross revenue" value={formatMoney(d.revenue.grossMinor)} hint={`${d.revenue.payments} payments · ${formatMoney(d.revenue.refundedMinor)} refunded`} icon={<IndianRupee />} />
            <StatCard label="Bookings created" value={d.bookings.created} hint={`${d.bookings.confirmed} confirmed`} icon={<CalendarCheck2 />} />
            <StatCard label="Checkout conversion" value={`${Math.round(d.bookings.conversionRate * 100)}%`} hint="Reserved → paid" icon={<Percent />} />
            <StatCard label="Users" value={(d.users.STUDENT ?? 0) + (d.users.TEACHER ?? 0)} hint={`${d.users.STUDENT ?? 0} students · ${d.teachers.APPROVED ?? 0} live teachers · ${d.teachers.PENDING ?? 0} pending`} icon={<Users />} />
          </div>
          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader title="Bookings per day" description="Created vs confirmed" />
              <div className="h-72 p-4">
                {d.daily.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={d.daily} margin={{ left: -20, right: 8, top: 8 }}>
                      <defs><linearGradient id="g1" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity={0.35} /><stop offset="1" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="day" {...axis} tickFormatter={(v) => v.slice(5)} />
                      <YAxis {...axis} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Area type="monotone" dataKey="bookings" name="Created" stroke="var(--muted-foreground)" fill="transparent" strokeDasharray="4 4" />
                      <Area type="monotone" dataKey="confirmed" name="Confirmed" stroke="var(--accent)" strokeWidth={2} fill="url(#g1)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <p className="grid h-full place-items-center text-sm text-muted-foreground">No bookings in this period.</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Top subjects" description="Confirmed sessions" />
              <div className="h-72 p-4">
                {d.topSubjects.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.topSubjects} layout="vertical" margin={{ left: 10, right: 12 }}>
                      <XAxis type="number" {...axis} allowDecimals={false} />
                      <YAxis type="category" dataKey="name" {...axis} width={110} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)' }} />
                      <Bar dataKey="bookings" fill="var(--accent)" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <p className="grid h-full place-items-center text-sm text-muted-foreground">No confirmed sessions yet.</p>}
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Revenue per day" />
            <div className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.daily} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" {...axis} tickFormatter={(v) => v.slice(5)} />
                  <YAxis {...axis} tickFormatter={(v) => `₹${Math.round(v / 100000)}k`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatMoney(v)} cursor={{ fill: 'var(--muted)' }} />
                  <Bar dataKey="revenueMinor" name="Revenue" fill="var(--accent)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><AlertTriangle className="size-3.5" />{d.ops.openTickets} open support ticket(s).</p>
        </div>
      )}
    </>
  );
}
