'use client';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarCheck2, GraduationCap, Search, Timer, Video, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Alert, Avatar, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { accountService } from '@/services/account';
import { firstName, formatMoney, formatRange, relative } from '@/utils/format';

export default function StudentOverview() {
  const { user, timezone } = useAuth();
  const q = useQuery({ queryKey: ['student', 'overview'], queryFn: accountService.studentOverview });
  return (
    <>
      <PageHeader title={`Hi ${user ? firstName(user.fullName) : ''}`} description="Here’s what’s coming up." actions={<Button asChild><Link href="/student/find"><Search />Find a teacher</Link></Button>} />
      {q.isError ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : q.isLoading || !q.data ? (
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : (
        <div className="space-y-6">
          {q.data.pendingCheckouts.map((p) => (
            <Alert key={p.id} tone="warning" title={`Finish paying for ${p.subject} with ${p.teacher}`} action={<Button asChild size="sm"><Link href={`/student/checkout/${p.id}`}>Pay now</Link></Button>}>
              Your slot is held until {new Date(p.holdExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
            </Alert>
          ))}
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Upcoming sessions" value={q.data.stats.upcoming} icon={<CalendarCheck2 />} />
            <StatCard label="Completed sessions" value={q.data.stats.completed} icon={<GraduationCap />} />
            <StatCard label="Total spent" value={formatMoney(q.data.stats.totalSpentMinor)} hint="Net of refunds" icon={<Wallet />} />
          </div>
          <Card>
            <CardHeader title="Next sessions" action={<Link href="/student/sessions" className="text-[13px] font-medium text-accent hover:underline">View all</Link>} />
            {q.data.nextSessions.length ? (
              <ul className="divide-y divide-border">
                {q.data.nextSessions.map((s) => (
                  <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                    <Avatar name={s.teacher.name} src={s.teacher.avatarUrl} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.subject} with {s.teacher.name}</p>
                      <p className="text-[13px] text-muted-foreground">{formatRange(s.startAt, s.endAt, timezone)} · <span className="inline-flex items-center gap-1"><Timer className="size-3" />{relative(s.startAt)}</span></p>
                    </div>
                    <div className="flex gap-2">
                      {s.meeting?.joinUrl && <Button asChild size="sm"><a href={s.meeting.joinUrl} target="_blank" rel="noopener noreferrer"><Video />Join</a></Button>}
                      <Button asChild size="sm" variant="secondary"><Link href={`/student/sessions/${s.id}`}>Details <ArrowRight /></Link></Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5"><EmptyState icon={<CalendarCheck2 />} title="No upcoming sessions" description="Find a teacher and pick a time that works for you." action={<Button asChild><Link href="/student/find">Browse teachers</Link></Button>} /></div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
