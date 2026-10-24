import { api } from '@/lib/api';
import type { Booking, Paginated } from '@/types/api';

type Q = Record<string, string | number | undefined>;

export interface AdminOverview {
  windowDays: number;
  users: Record<string, number>;
  teachers: Record<string, number>;
  bookings: { created: number; confirmed: number; conversionRate: number; byStatus: Record<string, number> };
  revenue: { grossMinor: number; payments: number; refundedMinor: number };
  daily: { day: string; bookings: number; confirmed: number; revenueMinor: number }[];
  topSubjects: { name: string; bookings: number }[];
  ops: { failedJobs: number; openDiscrepancies: number; openTickets: number };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const adminService = {
  overview: (days = 30) => api<AdminOverview>('/admin/overview', { query: { days } }),
  users: (q: Q) => api<Paginated<any>>('/admin/users', { query: q }),
  setUserStatus: (id: string, status: string, reason?: string) => api(`/admin/users/${id}/status`, { method: 'PATCH', body: { status, reason } }),
  setUserRole: (id: string, role: string) => api(`/admin/users/${id}/role`, { method: 'PATCH', body: { role } }),
  teachers: (q: Q) => api<Paginated<any>>('/admin/teachers', { query: q }),
  setApproval: (id: string, status: string, note?: string) => api(`/admin/teachers/${id}/approval`, { method: 'POST', body: { status, note } }),
  subjects: () => api<any[]>('/admin/subjects'),
  createSubject: (body: any) => api('/admin/subjects', { method: 'POST', body }),
  updateSubject: (id: string, body: any) => api(`/admin/subjects/${id}`, { method: 'PATCH', body }),
  categories: () => api<any[]>('/admin/categories'),
  createCategory: (body: any) => api('/admin/categories', { method: 'POST', body }),
  bookings: (q: Q) => api<Paginated<Booking>>('/admin/bookings', { query: q }),
  booking: (id: string) => api<Booking>(`/admin/bookings/${id}`),
  cancelBooking: (id: string, reason: string, refundPercent: number) => api(`/admin/bookings/${id}/cancel`, { method: 'POST', body: { reason, refundPercent } }),
  payments: (q: Q) => api<Paginated<any>>('/admin/payments', { query: q }),
  reconcile: (id: string) => api<{ outcome: string }>(`/admin/payments/${id}/reconcile`, { method: 'POST' }),
  resolve: (id: string, note: string) => api(`/admin/payments/${id}/resolve`, { method: 'POST', body: { note } }),
  refunds: (q: Q) => api<Paginated<any>>('/admin/refunds', { query: q }),
  retryRefund: (id: string) => api(`/admin/refunds/${id}/retry`, { method: 'POST' }),
  health: () => api<any>('/admin/integrations/health'),
  jobs: (q: Q) => api<Paginated<any>>('/admin/jobs', { query: q }),
  retryJob: (id: string) => api<{ result: string }>(`/admin/jobs/${id}/retry`, { method: 'POST' }),
  webhooks: (q: Q) => api<Paginated<any>>('/admin/webhooks', { query: q }),
  templates: () => api<any[]>('/admin/notification-templates'),
  updateTemplate: (key: string, body: { subject: string; htmlBody: string; textBody: string }) => api(`/admin/notification-templates/${key}`, { method: 'PUT', body }),
  resetTemplate: (key: string) => api(`/admin/notification-templates/${key}`, { method: 'DELETE' }),
  previewTemplate: (key: string) => api<{ subject: string; html: string; text: string }>(`/admin/notification-templates/${key}/preview`),
  audit: (q: Q) => api<Paginated<any>>('/admin/audit-logs', { query: q }),
  settings: () => api<{ key: string; description: string; value: any }[]>('/admin/settings'),
  setSetting: (key: string, value: unknown) => api(`/admin/settings/${key}`, { method: 'PUT', body: { value } }),
  tickets: (q: Q) => api<Paginated<any>>('/admin/support-tickets', { query: q }),
  updateTicket: (id: string, status: string, adminNote?: string) => api(`/admin/support-tickets/${id}`, { method: 'PATCH', body: { status, adminNote } }),
};
