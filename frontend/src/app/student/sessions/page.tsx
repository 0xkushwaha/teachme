'use client';
import { PageHeader } from '@/components/ui/primitives';
import { BookingList } from '@/features/booking/booking-list';

export default function Sessions() {
  return (
    <>
      <PageHeader title="Sessions" description="Upcoming sessions, history, and anything awaiting payment." />
      <BookingList viewer="student" />
    </>
  );
}
