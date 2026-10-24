'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarX2, ChevronRight, Video } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/overlay';
import { Avatar, EmptyState, ErrorState, Pagination, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { bookingService, type BookingScope } from '@/services/bookings';
import { formatMoney, formatRange, STATUS_LABEL } from '@/utils/format';

export function BookingList({ viewer }: { viewer: 'student' | 'teacher' }) {
  const { timezone } = useAuth();
  const [scope, setScope] = useState<BookingScope>('upcoming');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['bookings', viewer, scope, page], queryFn: () => bookingService.list(scope, page, 10), placeholderData: (p) => p });
  const base = viewer === 'student' ? '/student/sessions' : '/teacher/bookings';
  const tabs = [
    { value: 'upcoming', label: 'Upcoming' },
    ...(viewer === 'student' ? [{ value: 'pending', label: 'Awaiting payment' }] : []),
    { value: 'past', label: 'Past' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  return (
    <div className="space-y-4">
      <Tabs value={scope} onValueChange={(v) => { setScope(v as BookingScope); setPage(1); }} items={tabs} />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : q.data?.data.length ? (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
            {q.data.data.map((b) => {
              const other = viewer === 'student' ? b.teacher.name : b.student.name;
              const href = b.status === 'PENDING_PAYMENT' && viewer === 'student' ? `/student/checkout/${b.id}` : `${base}/${b.id}`;
              return (
                <li key={b.id} className="group relative flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-2/70 sm:px-5">
                  <Avatar name={other} src={viewer === 'student' ? b.teacher.avatarUrl : null} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={href} className="font-medium after:absolute after:inset-0">{b.subject.name} · {other}</Link>
                      <StatusBadge status={b.status} label={STATUS_LABEL[b.status]} />
                      {b.refunds.length > 0 && <StatusBadge status={b.refunds[0].status} label={`Refund ${b.refunds[0].status.toLowerCase()}`} />}
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{formatRange(b.startAt, b.endAt, timezone)} · {formatMoney(viewer === 'student' ? b.price.totalMinor : b.price.priceMinor, b.price.currency)}</p>
                  </div>
                  {b.meeting?.joinUrl && scope === 'upcoming' && (
                    <Button asChild size="sm" className="relative z-10 hidden sm:inline-flex"><a href={b.meeting.joinUrl} target="_blank" rel="noopener noreferrer"><Video />Join</a></Button>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </li>
              );
            })}
          </ul>
          <Pagination page={q.data.meta.page} totalPages={q.data.meta.totalPages} onPage={setPage} />
        </>
      ) : (
        <EmptyState
          icon={<CalendarX2 />}
          title={{ upcoming: 'No upcoming sessions', pending: 'Nothing awaiting payment', past: 'No past sessions yet', cancelled: 'No cancelled sessions', all: 'No sessions' }[scope]}
          description={viewer === 'student' && scope === 'upcoming' ? 'Book a session and it will appear here.' : undefined}
          action={viewer === 'student' && scope === 'upcoming' ? <Button asChild><Link href="/student/find">Find a teacher</Link></Button> : undefined}
        />
      )}
    </div>
  );
}
