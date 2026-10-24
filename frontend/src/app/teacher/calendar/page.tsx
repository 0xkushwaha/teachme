'use client';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { ErrorState, PageHeader } from '@/components/ui/primitives';
import { CalendarView, rangeFor, type CalView } from '@/features/calendar/calendar-view';
import { useAuth } from '@/hooks/use-auth';
import { errorMessage } from '@/lib/api';
import { bookingService } from '@/services/bookings';

export default function TeacherCalendar() {
  const { timezone } = useAuth();
  const [view, setView] = useState<CalView>('week');
  const [anchor, setAnchor] = useState<DateTime>(() => DateTime.now().setZone(timezone));
  const { from, to } = rangeFor(view, anchor);
  const q = useQuery({
    queryKey: ['teacher', 'calendar', from.toISO(), to.toISO()],
    queryFn: () => bookingService.teacherCalendar(from.toUTC().toISO()!, to.toUTC().toISO()!),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="Calendar" description="Confirmed sessions and slots currently held at checkout (amber)." />
      {q.isError ? <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
        <div className={q.isFetching ? 'opacity-70 transition-opacity' : ''}>
          <CalendarView bookings={q.data ?? []} timezone={timezone} view={view} onView={setView} anchor={anchor} onAnchor={setAnchor} hrefFor={(b) => `/teacher/bookings/${b.id}`} label={(b) => `${b.subject.name} · ${b.student.name}`} />
        </div>
      )}
    </>
  );
}
