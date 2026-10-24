'use client';
import { PageHeader } from '@/components/ui/primitives';
import { BookingList } from '@/features/booking/booking-list';

export default function TeacherBookings() {
  return (
    <>
      <PageHeader title="Bookings" description="Your sessions, payment status and history." />
      <BookingList viewer="teacher" />
    </>
  );
}
