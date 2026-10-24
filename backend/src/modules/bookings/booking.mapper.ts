import { Booking, Meeting, Payment, Refund, CalendarEvent } from '@prisma/client';

type Full = Booking & {
  subject: { id: string; name: string; slug: string };
  teacher: { id: string; slug: string; avatarUrl: string | null; timezone: string; user: { fullName: string } };
  student: { id: string; fullName: string; timezone: string; studentProfile?: { gradeLevel: string | null; learningGoals: string | null } | null };
  meeting?: Meeting | null;
  payments?: Payment[];
  refunds?: Refund[];
  calendarEvent?: CalendarEvent | null;
};

export type Viewer = 'STUDENT' | 'TEACHER' | 'ADMIN';

/** Booking projection per viewer. The Meet link is only exposed for confirmed sessions. */
export function toBookingView(b: Full, viewer: Viewer) {
  const latestPayment = b.payments?.slice().sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
  const showMeet = b.status === 'CONFIRMED' || b.status === 'COMPLETED';
  return {
    id: b.id,
    status: b.status,
    startAt: b.startAt,
    endAt: b.endAt,
    durationMinutes: b.durationMinutes,
    holdExpiresAt: b.status === 'PENDING_PAYMENT' ? b.holdExpiresAt : null,
    subject: b.subject,
    teacher: { id: b.teacher.id, slug: b.teacher.slug, name: b.teacher.user.fullName, avatarUrl: b.teacher.avatarUrl, timezone: b.teacher.timezone },
    student: {
      id: b.student.id,
      name: b.student.fullName,
      ...(viewer !== 'STUDENT' && b.student.studentProfile
        ? { gradeLevel: b.student.studentProfile.gradeLevel, learningGoals: b.student.studentProfile.learningGoals }
        : {}),
    },
    studentNote: b.studentNote,
    price: { priceMinor: b.priceMinor, platformFeeMinor: b.platformFeeMinor, taxMinor: b.taxMinor, totalMinor: b.totalMinor, currency: b.currency },
    payment: latestPayment
      ? {
          id: latestPayment.id,
          status: latestPayment.status,
          method: latestPayment.method,
          refundedMinor: latestPayment.refundedMinor,
          ...(viewer === 'ADMIN' ? { providerOrderId: latestPayment.providerOrderId, providerPaymentId: latestPayment.providerPaymentId, discrepancy: latestPayment.discrepancy } : {}),
        }
      : null,
    refunds: (b.refunds ?? []).map((r) => ({ id: r.id, amountMinor: r.amountMinor, status: r.status, reason: r.reason, createdAt: r.createdAt, processedAt: r.processedAt })),
    meeting: b.meeting
      ? {
          status: b.meeting.status,
          joinUrl: showMeet && b.meeting.status === 'READY' ? b.meeting.joinUrl : null,
          lastError: viewer === 'STUDENT' ? null : b.meeting.lastError,
        }
      : null,
    calendar: viewer !== 'STUDENT' && b.calendarEvent ? { status: b.calendarEvent.status, lastError: b.calendarEvent.lastError } : null,
    policy: b.policySnapshot,
    rescheduleCount: b.rescheduleCount,
    cancellationReason: b.cancellationReason,
    cancelledAt: b.cancelledAt,
    confirmedAt: b.confirmedAt,
    createdAt: b.createdAt,
  };
}

export const BOOKING_INCLUDE = {
  subject: { select: { id: true, name: true, slug: true } },
  teacher: { select: { id: true, slug: true, avatarUrl: true, timezone: true, userId: true, user: { select: { fullName: true } } } },
  student: { select: { id: true, fullName: true, timezone: true, studentProfile: { select: { gradeLevel: true, learningGoals: true } } } },
  meeting: true,
  payments: true,
  refunds: true,
  calendarEvent: true,
} as const;

export function toIcs(b: Full, meetUrl: string | null, appUrl: string): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const description = [`TeachMe session: ${b.subject.name} with ${b.teacher.user.fullName}`, meetUrl ? `Google Meet: ${meetUrl}` : '', `Manage: ${appUrl}/student/sessions/${b.id}`]
    .filter(Boolean)
    .join('\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TeachMe//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${b.id}@teachme`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(b.startAt)}`,
    `DTEND:${fmt(b.endAt)}`,
    `SUMMARY:${esc(`${b.subject.name} with ${b.teacher.user.fullName}`)}`,
    `DESCRIPTION:${esc(description)}`,
    meetUrl ? `LOCATION:${esc(meetUrl)}` : '',
    `STATUS:${b.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
}
