'use client';
import { use } from 'react';
import { BookingDetail } from '@/features/booking/booking-detail';

export default function TeacherBookingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <BookingDetail id={id} viewer="teacher" />;
}
