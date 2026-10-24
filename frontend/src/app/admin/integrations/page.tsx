'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleSlash, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Pagination, Skeleton, StatusBadge, Table } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { adminService } from '@/services/admin';
import { formatDateTime } from '@/utils/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
function Provider({ name, ok, detail }: { name: string; ok: boolean; detail: string }) {
  return (
    <Card className="flex items-start gap-3 p-4">
      {ok ? <CheckCircle2 className="mt-0.5 size-5 text-success" /> : <CircleSlash className="mt-0.5 size-5 text-warning" />}
      <div><p className="font-medium">{name}</p><p className="text-[13px] text-muted-foreground">{detail}</p></div>
    </Card>
  );
}

export default function IntegrationHealth() {
  const { timezone } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('FAILED');
  const [page, setPage] = useState(1);
  const health = useQuery({ queryKey: ['admin', 'health'], queryFn: adminService.health, refetchInterval: 30_000 });
  const jobs = useQuery({ queryKey: ['admin', 'jobs', status, page], queryFn: () => adminService.jobs({ status: status || undefined, page }), placeholderData: keepPreviousData });
  const webhooks = useQuery({ queryKey: ['admin', 'webhooks'], queryFn: () => adminService.webhooks({ failed: 'true', pageSize: 10 }) });
  const retry = useMutation({ mutationFn: adminService.retryJob, onSuccess: (r) => { toast.success(`Job ${r.result}`); qc.invalidateQueries({ queryKey: ['admin', 'jobs'] }); qc.invalidateQueries({ queryKey: ['admin', 'health'] }); }, onError: (e) => toast.error(errorMessage(e)) });
  const h = health.data;
  return (
    <>
      <PageHeader title="Integration health" description="Provider configuration, queues, outbox lag and failed operations. Refreshes every 30 seconds." actions={<Button variant="secondary" onClick={() => health.refetch()} loading={health.isFetching}><RefreshCw />Refresh</Button>} />
      {health.isError ? <ErrorState message={errorMessage(health.error)} /> : !h ? <Skeleton className="h-64 rounded-2xl" /> : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Provider name="Razorpay" ok={h.providers.razorpay.configured && h.providers.razorpay.webhookConfigured} detail={h.providers.razorpay.configured ? `${h.providers.razorpay.mode} mode · webhook ${h.providers.razorpay.webhookConfigured ? 'configured' : 'secret missing'}` : 'API keys not configured'} />
            <Provider name="Google Calendar / Meet" ok={h.providers.google.configured} detail={h.providers.google.configured ? `${h.calendar.connections.ACTIVE ?? 0} active teacher connections · ${h.calendar.connections.REVOKED ?? 0} revoked` : 'OAuth client not configured'} />
            <Provider name="Email" ok={h.providers.email.configured} detail={h.providers.email.configured ? `${h.providers.email.provider} · ${h.email.failed} failed · ${h.email.stalePending} stuck >10 min` : 'SMTP not configured'} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Queues" description={`Outbox: ${h.outbox.pending} pending${h.outbox.pending ? `, oldest ${h.outbox.oldestPendingAgeSeconds}s` : ''}`} />
              <Table className="rounded-none border-0 shadow-none">
                <thead><tr><th>Queue</th><th>Waiting</th><th>Active</th><th>Delayed</th><th>Failed</th></tr></thead>
                <tbody>{h.queues.map((q: any) => <tr key={q.queue}><td className="font-medium">{q.queue}</td><td className="tabular-nums">{q.waiting}</td><td className="tabular-nums">{q.active}</td><td className="tabular-nums">{q.delayed}</td><td className={`tabular-nums ${q.failed ? 'text-danger' : ''}`}>{q.failed}</td></tr>)}</tbody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="Calendar & Meet" />
              <div className="grid grid-cols-2 gap-4 p-5 text-sm">
                <div><p className="mb-2 text-[12px] font-medium text-muted-foreground">Calendar events</p>{Object.entries(h.calendar.events).map(([k, v]) => <p key={k} className="flex justify-between"><StatusBadge status={k} /><span className="tabular-nums">{v as number}</span></p>)}</div>
                <div><p className="mb-2 text-[12px] font-medium text-muted-foreground">Meetings</p>{Object.entries(h.calendar.meetings).map(([k, v]) => <p key={k} className="flex justify-between"><StatusBadge status={k} /><span className="tabular-nums">{v as number}</span></p>)}</div>
                <p className="col-span-2 text-[13px] text-muted-foreground">Unprocessed webhooks with errors: <span className={h.webhooks.failed ? 'text-danger' : ''}>{h.webhooks.failed}</span></p>
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Background jobs" description="Tracked integration work (emails, calendar, Meet, refunds). Retry is safe: every job is idempotent." action={
              <Select aria-label="Job status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-8 w-36 text-[13px]"><option value="FAILED">Failed</option><option value="DEAD">Dead</option><option value="PENDING">Pending</option><option value="RUNNING">Running</option><option value="SUCCEEDED">Succeeded</option><option value="">All</option></Select>
            } />
            {jobs.data?.data.length ? (
              <>
                <Table className="rounded-none border-0 shadow-none">
                  <thead><tr><th>Job</th><th>Entity</th><th>Status</th><th>Attempts</th><th>Last error</th><th>Updated</th><th /></tr></thead>
                  <tbody>{jobs.data.data.map((j: any) => (
                    <tr key={j.id}>
                      <td><p className="font-medium">{j.name}</p><p className="font-mono text-[11px] text-muted-foreground">{j.queue}</p></td>
                      <td className="font-mono text-[11px]">{j.entityType} {j.entityId?.slice(0, 8)}</td>
                      <td><StatusBadge status={j.status} /></td>
                      <td className="tabular-nums">{j.attempts}</td>
                      <td className="max-w-xs truncate text-[12px] text-danger" title={j.lastError ?? ''}>{j.lastError}</td>
                      <td className="whitespace-nowrap text-[12px]">{formatDateTime(j.updatedAt, timezone)}</td>
                      <td className="text-right">{(j.status === 'FAILED' || j.status === 'DEAD') && <Button size="sm" variant="ghost" loading={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>Retry</Button>}</td>
                    </tr>))}
                  </tbody>
                </Table>
                <div className="px-5 pb-4"><Pagination page={jobs.data.meta.page} totalPages={jobs.data.meta.totalPages} onPage={setPage} /></div>
              </>
            ) : <div className="p-5"><EmptyState title={status === 'FAILED' || status === 'DEAD' ? 'No failed jobs' : 'No jobs'} /></div>}
          </Card>
          {webhooks.data && webhooks.data.data.length > 0 && (
            <Card>
              <CardHeader title="Unprocessed webhooks" description="Razorpay retries these automatically; persistent errors need investigation." />
              <Table className="rounded-none border-0 shadow-none">
                <thead><tr><th>Event</th><th>Id</th><th>Error</th><th>Received</th></tr></thead>
                <tbody>{webhooks.data.data.map((w: any) => <tr key={w.id}><td>{w.eventType}</td><td className="font-mono text-[11px]">{w.eventId}</td><td className="text-[12px] text-danger">{w.error ?? 'pending'}</td><td className="text-[12px]">{formatDateTime(w.receivedAt, timezone)}</td></tr>)}</tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
