import { api } from '@/lib/api';
import type { AppNotification, Me, NotificationPreference, Paginated } from '@/types/api';

export const accountService = {
  update: (body: { fullName?: string; timezone?: string; phone?: string }) => api<{ user: Me }>('/users/me', { method: 'PATCH', body }).then((r) => r.user),
  exportUrl: '/api/v1/users/me/export',
  deleteAccount: (password: string) => api<void>('/users/me/delete', { method: 'POST', body: { password, confirm: 'DELETE' } }),
  studentProfile: () => api<{ gradeLevel: string | null; learningGoals: string | null; preferredLanguage: string | null }>('/students/me'),
  updateStudentProfile: (body: { gradeLevel?: string; learningGoals?: string; preferredLanguage?: string }) => api('/students/me', { method: 'PATCH', body }),
  studentOverview: () =>
    api<{
      stats: { upcoming: number; completed: number; totalSpentMinor: number };
      pendingCheckouts: { id: string; startAt: string; holdExpiresAt: string; subject: string; teacher: string }[];
      nextSessions: { id: string; startAt: string; endAt: string; subject: string; teacher: { name: string; slug: string; avatarUrl: string | null }; meeting: { status: string; joinUrl: string | null } | null }[];
    }>('/students/me/overview'),
};

export interface StudentPayment {
  id: string;
  amountMinor: number;
  currency: string;
  status: 'CAPTURED' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'FAILED';
  method: string | null;
  capturedAt: string | null;
  refundedMinor: number;
  createdAt: string;
  failureReason: string | null;
  booking: { id: string; startAt: string; durationMinutes: number; status: string; subject: string; teacher: string };
  refunds: { amountMinor: number; status: string; processedAt: string | null; createdAt: string }[];
}

export interface Receipt {
  receiptNumber: string;
  issuedAt: string;
  provider: string;
  providerPaymentId: string | null;
  method: string | null;
  currency: string;
  billedTo: { name: string; email: string };
  session: { bookingId: string; subject: string; teacher: string; startAt: string; durationMinutes: number; timezone: string; status: string };
  lines: { label: string; amountMinor: number }[];
  totalMinor: number;
  paidMinor: number;
  refunds: { amountMinor: number; processedAt: string | null }[];
  refundedMinor: number;
  netPaidMinor: number;
}

export interface ActiveAnnouncement {
  id: string;
  title: string;
  body: string;
  audience: string;
  startsAt: string;
  endsAt: string | null;
}

export const studentPaymentService = {
  list: (page = 1) => api<Paginated<StudentPayment>>('/students/me/payments', { query: { page, pageSize: 15 } }),
  receipt: (id: string) => api<Receipt>(`/students/me/payments/${id}/receipt`),
};

export const announcementService = {
  active: () => api<ActiveAnnouncement[]>('/announcements'),
};

export const notificationService = {
  list: (page = 1, unread = false) => api<Paginated<AppNotification>>('/notifications', { query: { page, pageSize: 20, unread: unread ? 'true' : undefined } }),
  unreadCount: () => api<{ count: number }>('/notifications/unread-count').then((r) => r.count),
  markRead: (id: string) => api<void>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => api<void>('/notifications/read-all', { method: 'POST' }),
  preferences: () => api<{ preferences: NotificationPreference[] }>('/notifications/preferences').then((r) => r.preferences),
  setPreferences: (preferences: NotificationPreference[]) => api<{ preferences: NotificationPreference[] }>('/notifications/preferences', { method: 'PUT', body: { preferences } }).then((r) => r.preferences),
};

export const supportService = {
  create: (body: { name: string; email: string; category: string; subject: string; message: string; bookingId?: string }) =>
    api<{ id: string; status: string }>('/support/tickets', { method: 'POST', body }),
  mine: () => api<{ id: string; category: string; subject: string; status: string; createdAt: string }[]>('/support/tickets/mine'),
};
