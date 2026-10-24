'use client';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { CalendarView, type CalView } from '@/features/calendar/calendar-view';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { bookingService } from '@/services/bookings';

export default function StudentCalendar() {
  const { timezone } = useAuth();
  const [view, setView] = useState<CalView>('month');
  const [anchor, setAnchor] = useState<DateTime>(() => DateTime.now().setZone(timezone));
  // Students have modest volumes; upcoming + recent history covers the calendar.
  const upcoming = useQuery({ queryKey: ['bookings', 'student', 'upcoming', 'cal'], queryFn: () => bookingService.list('upcoming', 1, 100) });
  const past = useQuery({ queryKey: ['bookings', 'student', 'past', 'cal'], queryFn: () => bookingService.list('past', 1, 100) });
  const all = [...(upcoming.data?.data ?? []), ...(past.data?.data ?? [])];
  return (
    <>
      <PageHeader title="Calendar" description="Your confirmed and completed sessions." />
      {upcoming.isError ? <ErrorState message={errorMessage(upcoming.error)} onRetry={() => upcoming.refetch()} /> : upcoming.isLoading ? <Skeleton className="h-[520px] rounded-2xl" /> : (
        <CalendarView bookings={all} timezone={timezone} view={view} onView={setView} anchor={anchor} onAnchor={setAnchor} hrefFor={(b) => `/student/sessions/${b.id}`} label={(b) => `${b.subject.name} · ${b.teacher.name}`} />
      )}
    </>
  );
}
