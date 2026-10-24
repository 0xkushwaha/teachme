import { api } from '@/lib/api';
import type { Booking, CheckoutOrder, Paginated } from '@/types/api';

export type BookingScope = 'upcoming' | 'past' | 'cancelled' | 'pending' | 'all';

export const bookingService = {
  create: (body: { teacherId: string; subjectId: string; startAt: string; durationMinutes: number; note?: string }, idempotencyKey: string) =>
    api<Booking>('/bookings', { method: 'POST', body, idempotencyKey }),
  list: (scope: BookingScope, page = 1, pageSize = 10) => api<Paginated<Booking>>('/bookings', { query: { scope, page, pageSize } }),
  get: (id: string) => api<Booking>(`/bookings/${id}`),
  cancel: (id: string, reason?: string) =>
    api<{ booking: Booking; refund: { refundMinor: number; rule: string; percent?: number } }>(`/bookings/${id}/cancel`, { method: 'POST', body: { reason } }),
  reschedule: (id: string, startAt: string, idempotencyKey: string) => api<Booking>(`/bookings/${id}/reschedule`, { method: 'POST', body: { startAt }, idempotencyKey }),
  teacherCalendar: (from: string, to: string) => api<Booking[]>('/bookings/teacher/calendar', { query: { from, to } }),
  icsUrl: (id: string) => `/api/v1/bookings/${id}/ics`,
};

export const paymentService = {
  createOrder: (bookingId: string, idempotencyKey: string) => api<CheckoutOrder>('/payments/orders', { method: 'POST', body: { bookingId }, idempotencyKey }),
  verify: (body: { bookingId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
    api<{ outcome: 'confirmed' | 'already_confirmed' | 'conflict_refunded' | 'pending' | 'failed' | 'mismatch'; bookingId: string }>('/payments/razorpay/verify', { method: 'POST', body }),
  clientFailure: (bookingId: string, reason: string) => api('/payments/razorpay/client-failure', { method: 'POST', body: { bookingId, reason } }),
};

export const meetingService = {
  retry: (bookingId: string) => api<{ status: string }>(`/meetings/booking/${bookingId}/retry`, { method: 'POST' }),
};
