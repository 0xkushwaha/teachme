import { api } from '@/lib/api';

export interface TeacherSelf {
  id: string;
  slug: string;
  headline: string;
  bio: string;
  qualifications: { title: string; institution: string; year?: number }[];
  yearsExperience: number;
  languages: string[];
  timezone: string;
  approvalStatus: string;
  sessionDurations: number[];
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  avatarUrl: string | null;
  user: { fullName: string; email: string };
  subjects: { subjectId: string; hourlyRateMinor: number; levels: string | null; isActive: boolean; subject: { id: string; slug: string; name: string } }[];
  pricingBounds: { minHourlyRateMinor: number; maxHourlyRateMinor: number };
  canSetPricing: boolean;
  profileComplete: boolean;
}

export interface AvailabilityState {
  settings: { timezone: string; sessionDurations: number[]; bufferMinutes: number; minNoticeMinutes: number; maxAdvanceDays: number };
  allowedDurations: number[];
  windows: { id: string; dayOfWeek: number; startMinute: number; endMinute: number }[];
  exceptions: { id: string; type: 'UNAVAILABLE' | 'AVAILABLE'; startAt: string; endAt: string; reason: string | null }[];
}

export interface TeacherOverview {
  approvalStatus: string;
  checklist: { profile: boolean; subjects: boolean; availability: boolean; calendar: boolean };
  stats: { upcoming: number; thisWeek: number; completedLast30Days: number; earningsLast30DaysMinor: number; pendingRefunds: number };
  calendar: { status: string; lastError: string | null } | null;
  nextSessions: { id: string; startAt: string; endAt: string; subject: string; student: string; meetingStatus: string | null }[];
}

export interface GoogleStatus {
  configured: boolean;
  enabled: boolean;
  meetEnabled: boolean;
  connection: { status: string; accountEmail: string | null; scopes: string[]; connectedAt: string; lastSyncedAt: string | null; lastError: string | null; failingEvents: number } | null;
  requiredScopes: string[];
}

export const teacherService = {
  me: () => api<TeacherSelf>('/teachers/me'),
  update: (body: Partial<Pick<TeacherSelf, 'headline' | 'bio' | 'qualifications' | 'yearsExperience' | 'languages'>> & { avatarUrl?: string }) =>
    api<TeacherSelf>('/teachers/me', { method: 'PATCH', body }),
  setSubjects: (subjects: { subjectId: string; hourlyRateMinor: number; levels?: string; isActive?: boolean }[]) => api<TeacherSelf>('/teachers/me/subjects', { method: 'PUT', body: { subjects } }),
  overview: () => api<TeacherOverview>('/teachers/me/overview'),
  availability: () => api<AvailabilityState>('/availability/me'),
  setWeekly: (windows: { dayOfWeek: number; startMinute: number; endMinute: number }[]) => api<AvailabilityState>('/availability/me/weekly', { method: 'PUT', body: { windows } }),
  addException: (body: { type: 'UNAVAILABLE' | 'AVAILABLE'; startAt: string; endAt: string; reason?: string }) =>
    api<{ affectedConfirmedBookings: number }>('/availability/me/exceptions', { method: 'POST', body }),
  removeException: (id: string) => api<void>(`/availability/me/exceptions/${id}`, { method: 'DELETE' }),
  updateSettings: (body: Partial<AvailabilityState['settings']>) => api<AvailabilityState>('/availability/me/settings', { method: 'PATCH', body }),
  googleStatus: () => api<GoogleStatus>('/integrations/google/status'),
  googleConnect: () => api<{ url: string }>('/integrations/google/connect', { method: 'POST' }),
  googleDisconnect: () => api<void>('/integrations/google/connection', { method: 'DELETE' }),
};
