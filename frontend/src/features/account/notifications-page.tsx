'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/overlay';
import { EmptyState, ErrorState, PageHeader, Pagination, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { notificationService } from '@/services/account';
import { cn } from '@/utils/cn';
import { relative } from '@/utils/format';

export function NotificationsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['notifications', tab, page], queryFn: () => notificationService.list(page, tab === 'unread') });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: notificationService.markAllRead, onSuccess: invalidate });
  const readOne = useMutation({ mutationFn: notificationService.markRead, onSuccess: invalidate });
  return (
    <>
      <PageHeader title="Notifications" actions={<Button variant="secondary" onClick={() => readAll.mutate()} loading={readAll.isPending}><CheckCheck />Mark all read</Button>} />
      <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }} items={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} className="mb-4" />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.isLoading ? <Skeleton className="h-64 rounded-2xl" /> : q.data?.data.length ? (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
            {q.data.data.map((n) => (
              <li key={n.id} className={cn('flex gap-3 px-5 py-4', !n.readAt && 'bg-accent-soft/30')}>
                <span className={cn('mt-2 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} aria-label={n.readAt ? undefined : 'Unread'} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{n.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">{relative(n.createdAt)}</p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  {n.data?.link && <Button asChild size="sm" variant="ghost"><Link href={n.data.link} onClick={() => !n.readAt && readOne.mutate(n.id)}>Open</Link></Button>}
                  {!n.readAt && <Button size="sm" variant="ghost" onClick={() => readOne.mutate(n.id)}>Mark read</Button>}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : <EmptyState icon={<BellOff />} title={tab === 'unread' ? 'You’re all caught up' : 'No notifications yet'} description="Booking updates, reminders and payment news will show up here." />}
    </>
  );
}
