import { api } from '@/lib/api';
import type { Paginated } from '@/types/api';

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

export interface TeacherDocument {
  id: string;
  type: 'DEGREE' | 'CERTIFICATE' | 'ID_PROOF' | 'EXPERIENCE' | 'OTHER';
  title: string;
  reviewStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  file: { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string };
}

export interface ApplicationState {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  submittedAt: string | null;
  rejectionReason: string | null;
  underReview: boolean;
  requireDocuments: boolean;
  documentCount: number;
  hasPhoto: boolean;
  checklist: { emailVerified: boolean; profile: boolean; subjects: boolean; availability: boolean; documents: boolean };
  canSubmit: boolean;
}

export interface EarningsSummary {
  currency: string;
  lifetimeMinor: number;
  paidOutMinor: number;
  inPayoutMinor: number;
  availableMinor: number;
  clearingMinor: number;
  pendingFromUpcomingMinor: number;
  thisMonthMinor: number;
  lastMonthMinor: number;
  sessions: { completed: number; upcoming: number; cancelled: number; cancellationRate90d: number };
  payouts: { enabled: boolean; minPayoutMinor: number; clearingDays: number; open: { id: string; amountMinor: number; status: string; requestedAt: string } | null; canRequest: boolean };
}

export interface EarningsSeries {
  timezone: string;
  weekly: { period: string; earningsMinor: number; sessions: number }[];
  monthly: { period: string; earningsMinor: number; sessions: number }[];
}

export interface LedgerEntry {
  id: string;
  type: 'SESSION' | 'ADJUSTMENT';
  amountMinor: number;
  currency: string;
  description: string;
  earnedAt: string;
  booking: { id: string; startAt: string; durationMinutes: number; subject: string; student: string } | null;
  payout: { id: string; status: string } | null;
}

export interface Payout {
  id: string;
  amountMinor: number;
  currency: string;
  status: 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  reference: string | null;
  note: string | null;
  rejectionReason: string | null;
  _count: { earnings: number };
}

const upload = (_path: string, file: File, fields: Record<string, string> = {}) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  return form;
};

export const teacherService = {
  me: () => api<TeacherSelf>('/teachers/me'),
  update: (body: Partial<Pick<TeacherSelf, 'headline' | 'bio' | 'qualifications' | 'yearsExperience' | 'languages'>>) =>
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
  application: () => api<ApplicationState>('/teachers/me/application'),
  submitApplication: () => api<ApplicationState>('/teachers/me/application/submit', { method: 'POST' }),
  documents: () => api<TeacherDocument[]>('/teachers/me/documents'),
  uploadDocument: (file: File, type: TeacherDocument['type'], title: string) =>
    api<TeacherDocument>('/teachers/me/documents', { method: 'POST', body: upload('', file, { type, title }) }),
  deleteDocument: (id: string) => api<void>(`/teachers/me/documents/${id}`, { method: 'DELETE' }),
  documentUrl: (id: string) => `/api/v1/teachers/me/documents/${id}/file`,
  uploadAvatar: (file: File) => api<{ avatarUrl: string }>('/teachers/me/avatar', { method: 'POST', body: upload('', file) }),
  removeAvatar: () => api<{ avatarUrl: null }>('/teachers/me/avatar', { method: 'DELETE' }),
  earnings: () => api<EarningsSummary>('/teachers/me/earnings'),
  earningsSeries: () => api<EarningsSeries>('/teachers/me/earnings/series'),
  ledger: (page = 1) => api<Paginated<LedgerEntry>>('/teachers/me/earnings/ledger', { query: { page, pageSize: 15 } }),
  payouts: (page = 1) => api<Paginated<Payout>>('/teachers/me/payouts', { query: { page, pageSize: 10 } }),
  requestPayout: (note?: string) => api<Payout>('/teachers/me/payouts', { method: 'POST', body: { note } }),
  cancelPayout: (id: string) => api<Payout>(`/teachers/me/payouts/${id}/cancel`, { method: 'POST' }),
  completeBooking: (id: string) => api(`/bookings/${id}/complete`, { method: 'POST' }),
};
