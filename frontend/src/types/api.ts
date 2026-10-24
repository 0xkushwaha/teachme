/** API contract types (mirrors backend responses documented in docs/api.md). */
export type Role = 'STUDENT' | 'TEACHER' | 'ADMIN';
export type BookingStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'PAYMENT_FAILED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  timezone: string;
  phone: string | null;
  emailVerified: boolean;
  createdAt: string;
  teacherProfile: { id: string; slug: string; approvalStatus: ApprovalStatus } | null;
}

export interface SubjectSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  teacherCount: number;
  fromHourlyRateMinor: number | null;
}

export interface Catalogue {
  categories: { id: string; slug: string; name: string; subjects: SubjectSummary[] }[];
}

export interface TeacherCard {
  id: string;
  slug: string;
  name: string;
  headline: string;
  avatarUrl: string | null;
  languages: string[];
  yearsExperience: number;
  timezone: string;
  sessionDurations: number[];
  subjects: { id: string; slug: string; name: string; hourlyRateMinor: number; currency: string; levels: string | null }[];
  fromHourlyRateMinor: number | null;
}

export interface CancellationPolicy {
  fullRefundHours: number;
  partialRefundHours: number;
  partialRefundPercent: number;
}
export interface ReschedulePolicy {
  minHoursBefore: number;
  maxReschedules: number;
}

export interface TeacherProfile extends TeacherCard {
  bio: string;
  qualifications: { title: string; institution: string; year?: number }[];
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  completedSessions: number;
  cancellationPolicy: CancellationPolicy;
}

export interface Slot {
  startAt: string;
  endAt: string;
}

export interface Quote {
  currency: string;
  durationMinutes: number;
  hourlyRateMinor: number;
  priceMinor: number;
  platformFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  platformFeeBps: number;
  taxBps: number;
  taxBase: 'PLATFORM_FEE' | 'SUBTOTAL';
  holdMinutes: number;
  policy: { cancellation: CancellationPolicy; reschedule: ReschedulePolicy };
}

export interface Booking {
  id: string;
  status: BookingStatus;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  holdExpiresAt: string | null;
  subject: { id: string; name: string; slug: string };
  teacher: { id: string; slug: string; name: string; avatarUrl: string | null; timezone: string };
  student: { id: string; name: string; gradeLevel?: string | null; learningGoals?: string | null };
  studentNote: string | null;
  price: { priceMinor: number; platformFeeMinor: number; taxMinor: number; totalMinor: number; currency: string };
  payment: { id: string; status: string; method: string | null; refundedMinor: number; providerOrderId?: string; providerPaymentId?: string | null; discrepancy?: string | null } | null;
  refunds: { id: string; amountMinor: number; status: string; reason: string; createdAt: string; processedAt: string | null }[];
  meeting: { status: 'PENDING' | 'READY' | 'FAILED' | 'CANCELLED' | 'NOT_CONFIGURED'; joinUrl: string | null; lastError: string | null } | null;
  calendar: { status: string; lastError: string | null } | null;
  policy: { cancellation: CancellationPolicy; reschedule: ReschedulePolicy };
  rescheduleCount: number;
  cancellationReason: string | null;
  cancelledAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  history?: { fromStatus: BookingStatus | null; toStatus: BookingStatus; reason: string | null; createdAt: string }[];
}

export interface CheckoutOrder {
  provider: 'razorpay';
  keyId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  holdExpiresAt: string;
  description: string;
  prefill: { name: string; email: string; contact?: string };
}

export interface AppNotification {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  data: { link?: string | null } | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreference {
  channel: 'EMAIL' | 'IN_APP';
  category: 'BOOKING' | 'REMINDER' | 'PAYMENT' | 'MARKETING';
  enabled: boolean;
}

export interface PlatformConfig {
  pricing: { currency: string; platformFeeBps: number; taxBps: number; taxBase: 'PLATFORM_FEE' | 'SUBTOTAL' };
  policy: { cancellation: CancellationPolicy; reschedule: ReschedulePolicy };
  booking: { holdMinutes: number; allowedDurations: number[] };
  reminders: { offsetsMinutes: number[] };
  registration: { students: boolean; teachers: boolean };
  maintenanceBanner: string | null;
  counts: { teachers: number; subjects: number };
}
