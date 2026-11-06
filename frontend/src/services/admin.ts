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

export interface Invitation {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  note: string | null;
  sendCount: number;
  lastSentAt: string;
  deliveredAt: string | null;
  lastDeliveryError: string | null;
  acceptedAt: string | null;
  acceptedUserId: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface FinanceSummary {
  range: { from: string; to: string };
  collectedMinor: number;
  payments: number;
  refundedMinor: number;
  refunds: number;
  netCollectedMinor: number;
  platformFeeMinor: number;
  taxMinor: number;
  teacherEarningsMinor: number;
  payoutsPaidMinor: number;
  payoutsPaid: number;
  outstandingTeacherBalanceMinor: number;
  openPayouts: { count: number; amountMinor: number };
  topTeachers: { teacherId: string; name: string; earnedMinor: number; sessions: number }[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: 'ALL' | 'STUDENT' | 'TEACHER';
  startsAt: string;
  endsAt: string | null;
  archivedAt?: string | null;
  createdAt?: string;
}

export type AnnouncementInput = { title: string; body: string; audience: Announcement['audience']; startsAt?: string; endsAt?: string | null };

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
  deleteSubject: (id: string) => api(`/admin/subjects/${id}`, { method: 'DELETE' }),
  categories: () => api<any[]>('/admin/categories'),
  createCategory: (body: any) => api('/admin/categories', { method: 'POST', body }),
  deleteCategory: (id: string) => api(`/admin/categories/${id}`, { method: 'DELETE' }),
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
  userDetail: (id: string) => api<any>(`/admin/users/${id}`),
  removeUser: (id: string, confirmEmail: string, reason: string) => api(`/admin/users/${id}/remove`, { method: 'POST', body: { confirmEmail, reason } }),
  teacher: (id: string) => api<any>(`/admin/teachers/${id}`),
  teacherDocumentUrl: (teacherId: string, docId: string) => `/api/v1/admin/teachers/${teacherId}/documents/${docId}/file`,
  reviewDocument: (teacherId: string, docId: string, status: 'VERIFIED' | 'REJECTED', note?: string) =>
    api(`/admin/teachers/${teacherId}/documents/${docId}/review`, { method: 'POST', body: { status, note } }),
  teacherEarnings: (id: string, page = 1) => api<any>(`/admin/teachers/${id}/earnings`, { query: { page, pageSize: 10 } }),
  addAdjustment: (id: string, amountMinor: number, description: string) => api(`/admin/teachers/${id}/earnings/adjustments`, { method: 'POST', body: { amountMinor, description } }),
  invitations: (q: Q) => api<Paginated<Invitation>>('/admin/invitations', { query: q }),
  invite: (email: string, note?: string) => api<Invitation>('/admin/invitations', { method: 'POST', body: { email, note } }),
  resendInvitation: (id: string) => api<Invitation>(`/admin/invitations/${id}/resend`, { method: 'POST' }),
  revokeInvitation: (id: string) => api<Invitation>(`/admin/invitations/${id}/revoke`, { method: 'POST' }),
  deleteInvitation: (id: string) => api(`/admin/invitations/${id}`, { method: 'DELETE' }),
  payouts: (q: Q) => api<Paginated<any> & { totals: { status: string; count: number; amountMinor: number }[] }>('/admin/payouts', { query: q }),
  approvePayout: (id: string, note?: string) => api(`/admin/payouts/${id}/approve`, { method: 'POST', body: { note } }),
  markPayoutPaid: (id: string, reference: string, note?: string) => api(`/admin/payouts/${id}/paid`, { method: 'POST', body: { reference, note } }),
  rejectPayout: (id: string, reason: string) => api(`/admin/payouts/${id}/reject`, { method: 'POST', body: { reason } }),
  finance: (from: string, to: string) => api<FinanceSummary>('/admin/finance/summary', { query: { from, to } }),
  financeCsvUrl: (from: string, to: string) => `/api/v1/admin/finance/report.csv?${new URLSearchParams({ from, to })}`,
  announcements: (q: Q) => api<Paginated<Announcement>>('/admin/announcements', { query: q }),
  createAnnouncement: (body: AnnouncementInput) => api<Announcement>('/admin/announcements', { method: 'POST', body }),
  updateAnnouncement: (id: string, body: AnnouncementInput) => api<Announcement>(`/admin/announcements/${id}`, { method: 'PATCH', body }),
  archiveAnnouncement: (id: string) => api(`/admin/announcements/${id}/archive`, { method: 'POST' }),
  deleteAnnouncement: (id: string) => api(`/admin/announcements/${id}`, { method: 'DELETE' }),
  tickets: (q: Q) => api<Paginated<any>>('/admin/support-tickets', { query: q }),
  updateTicket: (id: string, status: string, adminNote?: string) => api(`/admin/support-tickets/${id}`, { method: 'PATCH', body: { status, adminNote } }),
  deleteTicket: (id: string) => api(`/admin/support-tickets/${id}`, { method: 'DELETE' }),
};
