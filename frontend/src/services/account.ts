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
