'use client';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck2, CheckCircle2, Circle, IndianRupee, Timer, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, StatusBadge } from '@/components/ui/primitives';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { teacherService } from '@/services/teacher';
import { firstName, formatMoney, formatRange, relative } from '@/utils/format';

export default function TeacherOverview() {
  const { user, timezone } = useAuth();
  const q = useQuery({ queryKey: ['teacher', 'overview'], queryFn: teacherService.overview });
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96 rounded-2xl" />;
  const d = q.data;
  const steps = [
    { done: d.checklist.profile, label: 'Write your headline and bio', href: '/teacher/profile' },
    { done: d.checklist.subjects, label: 'Add subjects and hourly rates', href: '/teacher/profile#subjects' },
    { done: d.checklist.availability, label: 'Set your weekly hours', href: '/teacher/availability' },
    { done: d.checklist.calendar, label: 'Connect Google Calendar for Meet links', href: '/teacher/integrations' },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  return (
    <>
      <PageHeader title={`Welcome, ${user ? firstName(user.fullName) : ''}`} description="Your teaching at a glance." actions={<Button asChild variant="secondary"><Link href="/teacher/calendar">Open calendar</Link></Button>} />
      {d.calendar && d.calendar.status !== 'ACTIVE' && (
        <Alert tone="danger" title="Google Calendar needs reconnecting" className="mb-6" action={<Button asChild size="sm"><Link href="/teacher/integrations">Reconnect</Link></Button>}>
          New sessions can’t get calendar events or Meet links until you reconnect. {d.calendar.lastError}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Upcoming" value={d.stats.upcoming} icon={<CalendarCheck2 />} />
        <StatCard label="Next 7 days" value={d.stats.thisWeek} icon={<Timer />} />
        <StatCard label="Completed (30 days)" value={d.stats.completedLast30Days} icon={<TrendingUp />} />
        <StatCard label="Session value (30 days)" value={formatMoney(d.stats.earningsLast30DaysMinor)} hint="Before platform fees and taxes" icon={<IndianRupee />} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Next sessions" action={<Link href="/teacher/bookings" className="text-[13px] font-medium text-accent hover:underline">All bookings</Link>} />
          {d.nextSessions.length ? (
            <ul className="divide-y divide-border">
              {d.nextSessions.map((s) => (
                <li key={s.id}>
                  <Link href={`/teacher/bookings/${s.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2/60">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.subject} · {s.student}</p>
                      <p className="text-[13px] text-muted-foreground">{formatRange(s.startAt, s.endAt, timezone)} · {relative(s.startAt)}</p>
                    </div>
                    {s.meetingStatus && s.meetingStatus !== 'READY' ? <StatusBadge status={s.meetingStatus === 'PENDING' ? 'PENDING' : 'FAILED'} label={s.meetingStatus === 'PENDING' ? 'Meet pending' : 'No Meet link'} /> : s.meetingStatus === 'READY' ? <StatusBadge status="READY" label="Meet ready" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5"><EmptyState icon={<CalendarCheck2 />} title="No upcoming sessions" description={d.approvalStatus === 'APPROVED' ? 'Students can book you in your open hours.' : 'Bookings open once your profile is approved.'} /></div>
          )}
        </Card>
        <Card>
          <CardHeader title="Setup" description={remaining ? `${remaining} step${remaining > 1 ? 's' : ''} left` : 'All set'} />
          <ul className="space-y-1 p-3">
            {steps.map((s) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-muted">
                  {s.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                  <span className={s.done ? 'text-muted-foreground line-through' : ''}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
          {d.stats.pendingRefunds > 0 && <p className="flex items-center gap-2 border-t border-border px-5 py-3 text-[13px] text-muted-foreground"><AlertTriangle className="size-4 text-warning" />{d.stats.pendingRefunds} booking(s) with refunds in progress.</p>}
        </Card>
      </div>
    </>
  );
}
