'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, CheckCircle2, ExternalLink, ShieldCheck, Unplug } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardHeader, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { teacherService } from '@/services/teacher';
import { formatDateTime } from '@/utils/format';

function Integrations() {
  const params = useSearchParams();
  const { timezone } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['teacher', 'google'], queryFn: teacherService.googleStatus });
  const connect = useMutation({ mutationFn: teacherService.googleConnect, onSuccess: ({ url }) => window.location.assign(url), onError: (e) => toast.error(errorMessage(e)) });
  const disconnect = useMutation({ mutationFn: teacherService.googleDisconnect, onSuccess: () => { toast.success('Google Calendar disconnected'); qc.invalidateQueries({ queryKey: ['teacher'] }); }, onError: (e) => toast.error(errorMessage(e)) });

  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-72 rounded-2xl" />;
  const s = q.data;
  const c = s.connection;
  const active = c?.status === 'ACTIVE';
  return (
    <>
      <PageHeader title="Google Calendar & Meet" description="Connect your Google account so every confirmed session is added to your calendar with a Google Meet link." />
      <div className="space-y-4">
        {params.get('google') === 'connected' && <Alert tone="success" title="Google Calendar connected">New confirmed sessions will appear in your calendar with a Meet link.</Alert>}
        {params.get('google') === 'error' && <Alert tone="danger" title="Couldn’t connect Google Calendar">{params.get('reason') ?? 'Please try again.'}</Alert>}
        {!s.configured && <Alert tone="warning" title="Not available on this server">The platform administrator hasn’t configured Google OAuth yet. Sessions still work; Meet links won’t be created automatically.</Alert>}
        {s.configured && !s.enabled && <Alert tone="info">Calendar sync is temporarily disabled by the platform.</Alert>}
        {c && c.status !== 'ACTIVE' && <Alert tone="danger" title="Access expired or revoked">Google no longer lets us manage your calendar ({c.lastError ?? 'permission revoked'}). Reconnect to restore calendar events and Meet links.</Alert>}
        {active && c.failingEvents > 0 && <Alert tone="warning" title={`${c.failingEvents} session(s) failed to sync`}>{c.lastError ?? 'We’ll keep retrying automatically.'} You can retry Meet creation from each booking.</Alert>}

        <Card>
          <CardHeader title="Connection" action={c && <StatusBadge status={c.status} />} />
          <div className="space-y-4 p-5">
            {active ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 text-success" />
                <div className="text-sm">
                  <p className="font-medium">Connected{c.accountEmail ? ` as ${c.accountEmail}` : ''}</p>
                  <p className="text-muted-foreground">Since {formatDateTime(c.connectedAt, timezone)}{c.lastSyncedAt ? ` · last sync ${formatDateTime(c.lastSyncedAt, timezone)}` : ''}</p>
                </div>
              </div>
            ) : (
              <p className="flex items-start gap-3 text-sm text-muted-foreground"><CalendarCheck2 className="mt-0.5 size-5 text-accent" />Not connected. You’ll be redirected to Google to grant access.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => connect.mutate()} loading={connect.isPending} disabled={!s.configured}>
                <ExternalLink />{active ? 'Reconnect' : c ? 'Reconnect Google Calendar' : 'Connect Google Calendar'}
              </Button>
              {c && c.status !== 'REVOKED' && <Button variant="secondary" onClick={() => disconnect.mutate()} loading={disconnect.isPending}><Unplug />Disconnect</Button>}
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <p className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-accent" />What we access</p>
          <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
            <li>• Permission to create, update and delete events (<code className="font-mono text-[12px]">calendar.events</code>) — used only for TeachMe sessions.</li>
            <li>• Your Google email address, to show which account is connected.</li>
            <li>• Your refresh token is stored encrypted and never leaves our servers. Disconnecting revokes it at Google.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense><Integrations /></Suspense>;
}
