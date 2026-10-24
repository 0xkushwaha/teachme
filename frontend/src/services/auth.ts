import { api } from '@/lib/api';
import type { Me } from '@/types/api';

export const authService = {
  me: () => api<{ user: Me }>('/auth/me').then((r) => r.user),
  login: (email: string, password: string) => api<{ user: Me }>('/auth/login', { method: 'POST', body: { email, password }, noRefresh: true }).then((r) => r.user),
  register: (body: { email: string; password: string; fullName: string; role: 'STUDENT' | 'TEACHER'; timezone: string; acceptTerms: boolean }) =>
    api<{ user: Me }>('/auth/register', { method: 'POST', body, noRefresh: true }).then((r) => r.user),
  logout: () => api<void>('/auth/logout', { method: 'POST', noRefresh: true }),
  verifyEmail: (token: string) => api<{ verified: boolean }>('/auth/verify-email', { method: 'POST', body: { token }, noRefresh: true }),
  resendVerification: () => api<{ queued: boolean }>('/auth/resend-verification', { method: 'POST' }),
  forgotPassword: (email: string) => api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email }, noRefresh: true }),
  resetPassword: (token: string, password: string) => api<{ reset: boolean }>('/auth/reset-password', { method: 'POST', body: { token, password }, noRefresh: true }),
  changePassword: (currentPassword: string, newPassword: string) => api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
};
