import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { formatMinor } from '../../utils/money';
import { formatInZone } from '../../utils/time';
import type { PolicySnapshot } from '../bookings/booking-policy';

export type Recipient = 'student' | 'teacher';

/** Builds template variables for a booking, localised to the recipient's timezone. */
@Injectable()
export class NotificationContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async forBooking(bookingId: string, recipient: Recipient) {
    const b = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: {
        student: { select: { id: true, fullName: true, timezone: true } },
        teacher: { include: { user: { select: { id: true, fullName: true, timezone: true } } } },
        subject: { select: { name: true } },
        meeting: true,
      },
    });
    const isStudent = recipient === 'student';
    const user = isStudent ? b.student : b.teacher.user;
    const counterpart = isStudent ? b.teacher.user.fullName : b.student.fullName;
    const tz = user.timezone;
    const policy = b.policySnapshot as unknown as PolicySnapshot;
    const meetReady = b.meeting?.status === 'READY' && b.meeting.joinUrl;
    const app = this.config.env.APP_URL;
    const bookingPath = isStudent ? `/student/sessions/${b.id}` : `/teacher/bookings/${b.id}`;

    return {
      userId: user.id,
      link: bookingPath,
      prefsUrl: `${app}/${isStudent ? 'student' : 'teacher'}/settings`,
      data: {
        user: { name: user.fullName.split(' ')[0] },
        session: {
          subject: b.subject.name,
          counterpart,
          time: formatInZone(b.startAt, tz),
          timezone: tz,
          duration: b.durationMinutes,
          note: isStudent ? '' : (b.studentNote ?? ''),
        },
        meet: {
          url: meetReady ? b.meeting!.joinUrl : '',
          pending: !meetReady && b.meeting?.status === 'PENDING',
          missing: !meetReady,
        },
        booking: { url: `${app}${bookingPath}`, icsUrl: `${this.config.env.API_URL}/api/v1/bookings/${b.id}/ics` },
        payment: { amount: formatMinor(b.totalMinor, b.currency) },
        policy: {
          text: policy?.cancellation
            ? `Free cancellation up to ${policy.cancellation.fullRefundHours}h before the session; ${policy.cancellation.partialRefundPercent}% refund up to ${policy.cancellation.partialRefundHours}h before.`
            : '',
        },
      },
      booking: b,
    };
  }
}
