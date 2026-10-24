import { Inject, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppError, ErrorCode } from '../../common/errors';
import type { AuthUser } from '../../common/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { AuditService } from '../../services/audit.service';
import { OutboxService } from '../../services/outbox.service';
import { JobQueueService } from '../../jobs/job-queue.service';
import { JOBS, jobKey, QUEUES, QueueName } from '../../jobs/queues';
import { AppConfig } from '../../config/app-config';
import { PAYMENT_GATEWAY, PaymentGateway } from '../../integrations/razorpay/payment-gateway';
import { CALENDAR_GATEWAY, CalendarGateway } from '../../integrations/google/calendar-gateway';
import { EMAIL_PROVIDER, EmailProvider } from '../../integrations/email/email-provider';
import { BOOKING_INCLUDE, toBookingView } from '../bookings/booking.mapper';
import { referencedVariables } from '../notifications/template-renderer';
import { TEMPLATE_BY_KEY, TEMPLATE_DEFAULTS } from '../notifications/templates/defaults';
import { EmailSenderService } from '../notifications/email-sender.service';
import {
  AdminBookingsQuery,
  AdminJobsQuery,
  AdminPaymentsQuery,
  AdminTeachersQuery,
  AdminUsersQuery,
  AuditQuery,
  TicketsQuery,
  UpdateTemplateDto,
} from './dto/admin.dto';

const SAMPLE_CONTEXT = {
  user: { name: 'Aanya' },
  link: 'https://teachme.example/verify?token=sample',
  session: { subject: 'Physics', counterpart: 'Dr. Meera Iyer', time: 'Tue, 4 Nov 2026, 5:30 PM IST', timezone: 'Asia/Kolkata', duration: 60, note: 'Rotational motion' },
  meet: { url: 'https://meet.google.com/sample-link', pending: false, missing: false },
  booking: { url: 'https://teachme.example/student/sessions/sample', icsUrl: 'https://teachme.example/api/v1/bookings/sample/ics' },
  payment: { amount: '₹1,073.50', reason: 'Card declined' },
  policy: { text: 'Free cancellation up to 24h before the session; 50% refund up to 4h before.' },
  previous: { time: 'Mon, 3 Nov 2026, 5:30 PM IST' },
  cancel: { by: 'the student', reason: 'Exam clash' },
  refund: { amount: '₹1,073.50', status: 'processed', note: 'Refunds usually reach your account in 5-7 working days.', text: 'A refund of ₹1,073.50 has been initiated.' },
  reminder: { when: 'in 1 hour' },
  approval: { status: 'approved', message: 'Welcome aboard! Students can now discover and book you.' },
  dashboard: { url: 'https://teachme.example/teacher' },
  alert: { title: 'Refund failed', detail: 'Refund abc failed: insufficient balance' },
  admin: { url: 'https://teachme.example/admin/integrations' },
  prefsUrl: 'https://teachme.example/student/settings',
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly jobs: JobQueueService,
    private readonly config: AppConfig,
    private readonly emailSender: EmailSenderService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: PaymentGateway,
    @Inject(CALENDAR_GATEWAY) private readonly calendar: CalendarGateway,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  // ---------- Users ----------
  async users(q: AdminUsersQuery) {
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : { status: { not: 'DELETED' } }),
      ...(q.q ? { OR: [{ email: { contains: q.q.toLowerCase() } }, { fullName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        select: {
          id: true, email: true, fullName: true, role: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true, timezone: true,
          teacherProfile: { select: { id: true, approvalStatus: true, slug: true } },
          _count: { select: { bookingsAsStudent: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async setUserStatus(admin: AuthUser, userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED', reason?: string) {
    if (userId === admin.id) throw AppError.forbidden('You cannot change your own status');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status === 'DELETED') throw AppError.notFound('User');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { status } });
      if (status !== 'ACTIVE') await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.user_status_changed', entityType: 'User', entityId: userId, metadata: { from: user.status, to: status, reason: reason ?? null } }, tx);
    });
    return { id: userId, status };
  }

  async setUserRole(admin: AuthUser, userId: string, role: Role) {
    if (userId === admin.id) throw AppError.forbidden('You cannot change your own role');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { teacherProfile: true } });
    if (!user || user.status === 'DELETED') throw AppError.notFound('User');
    const allowed: Role[] = user.teacherProfile ? ['TEACHER', 'ADMIN'] : ['STUDENT', 'ADMIN'];
    if (!allowed.includes(role)) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `This account can only hold roles: ${allowed.join(', ')}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { role } });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.user_role_changed', entityType: 'User', entityId: userId, metadata: { from: user.role, to: role } }, tx);
    });
    return { id: userId, role };
  }

  // ---------- Teachers ----------
  async teachers(q: AdminTeachersQuery) {
    const where: Prisma.TeacherProfileWhereInput = {
      user: { status: { not: 'DELETED' }, ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q.toLowerCase() } }] } : {}) },
      ...(q.approvalStatus ? { approvalStatus: q.approvalStatus } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.teacherProfile.findMany({
        where,
        orderBy: [{ approvalStatus: 'asc' }, { createdAt: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
        include: {
          user: { select: { id: true, email: true, fullName: true, status: true, emailVerifiedAt: true } },
          subjects: { include: { subject: { select: { name: true } } } },
          _count: { select: { bookings: true, availability: true } },
        },
      }),
      this.prisma.teacherProfile.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async setTeacherApproval(admin: AuthUser, teacherId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'PENDING', note?: string) {
    const t = await this.prisma.teacherProfile.findUnique({ where: { id: teacherId }, include: { _count: { select: { subjects: true } } } });
    if (!t) throw AppError.notFound('Teacher');
    if (status === 'APPROVED' && (t.headline.length < 10 || t.bio.length < 50 || t._count.subjects === 0))
      throw AppError.unprocessable(ErrorCode.VALIDATION_FAILED, 'Profile is incomplete: needs a headline, bio and at least one subject');
    await this.prisma.$transaction(async (tx) => {
      await tx.teacherProfile.update({
        where: { id: teacherId },
        data: { approvalStatus: status, ...(status === 'APPROVED' ? { approvedAt: new Date(), approvedById: admin.id } : {}) },
      });
      await this.outbox.publish(tx, { type: 'teacher.approval_changed', aggregateId: teacherId, payload: { teacherId, status } });
      await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.teacher_approval_changed', entityType: 'TeacherProfile', entityId: teacherId, metadata: { from: t.approvalStatus, to: status, note: note ?? null } }, tx);
    });
    return { id: teacherId, approvalStatus: status };
  }

  // ---------- Bookings ----------
  async bookings(q: AdminBookingsQuery) {
    const where: Prisma.BookingWhereInput = {
      ...(q.status ? { status: q.status as Prisma.EnumBookingStatusFilter['equals'] } : {}),
      ...(q.teacherId ? { teacherId: q.teacherId } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.from || q.to ? { startAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize, include: BOOKING_INCLUDE }),
      this.prisma.booking.count({ where }),
    ]);
    return paginate(rows.map((r) => toBookingView(r, 'ADMIN')), total, q);
  }

  // ---------- Payments ----------
  async payments(q: AdminPaymentsQuery) {
    const where: Prisma.PaymentWhereInput = {
      ...(q.status ? { status: q.status as Prisma.EnumPaymentStatusFilter['equals'] } : {}),
      ...(q.discrepancy === 'true' ? { discrepancy: { not: null }, discrepancyResolvedAt: null } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: {
          booking: { select: { id: true, status: true, startAt: true, student: { select: { fullName: true, email: true } }, subject: { select: { name: true } } } },
          refunds: true,
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async resolveDiscrepancy(admin: AuthUser, paymentId: string, note: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p || !p.discrepancy) throw AppError.notFound('Discrepancy');
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: paymentId }, data: { discrepancyResolvedAt: new Date() } });
      await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.payment_discrepancy_resolved', entityType: 'Payment', entityId: paymentId, metadata: { discrepancy: p.discrepancy, note } }, tx);
    });
    return { resolved: true };
  }

  async refunds(q: { skip: number; pageSize: number; page: number }, status?: string) {
    const where: Prisma.RefundWhereInput = status ? { status: status as Prisma.EnumRefundStatusFilter['equals'] } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize, include: { payment: { select: { providerPaymentId: true, amountMinor: true } } } }),
      this.prisma.refund.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async retryRefund(admin: AuthUser, refundId: string) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!r) throw AppError.notFound('Refund');
    if (r.status === 'PROCESSED') throw AppError.unprocessable(ErrorCode.CONFLICT, 'Refund already processed');
    if (r.status === 'FAILED') await this.prisma.refund.update({ where: { id: refundId }, data: { status: r.providerRefundId ? 'SUBMITTED' : 'PENDING', failureReason: null } });
    await this.jobs.enqueue(QUEUES.payments, JOBS.refundProcess, { refundId }, { key: jobKey('refund', refundId, 'retry', Date.now()), track: true, entityType: 'Refund', entityId: refundId });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.refund_retried', entityType: 'Refund', entityId: refundId });
    return { queued: true };
  }

  // ---------- Integrations & jobs ----------
  async integrationHealth() {
    const counts = await Promise.all(
      this.jobs.allQueues().map(async (q) => ({ queue: q.name, ...(await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')) })),
    );
    const [connections, calendarEvents, meetings, failedJobs, outboxPending, oldestOutbox, webhooksFailed, emailFailed, emailPending] = await Promise.all([
      this.prisma.calendarConnection.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.calendarEvent.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.meeting.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.jobRecord.findMany({ where: { status: { in: ['FAILED', 'DEAD'] } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
      this.prisma.webhookEvent.count({ where: { processedAt: null, error: { not: null } } }),
      this.prisma.notification.count({ where: { channel: 'EMAIL', status: 'FAILED' } }),
      this.prisma.notification.count({ where: { channel: 'EMAIL', status: 'PENDING', createdAt: { lt: new Date(Date.now() - 10 * 60_000) } } }),
    ]);
    const group = (rows: { status: string; _count: { _all: number } }[]) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    return {
      providers: {
        razorpay: { configured: this.paymentGateway.configured, mode: this.config.env.RAZORPAY_KEY_ID.startsWith("rzp_live_") ? "live" : this.paymentGateway.configured ? 'test' : 'unconfigured', webhookConfigured: this.config.razorpayWebhookConfigured },
        google: { configured: this.calendar.configured },
        email: { configured: this.email.configured, provider: this.email.name },
      },
      queues: counts,
      outbox: { pending: outboxPending, oldestPendingAgeSeconds: oldestOutbox ? Math.round((Date.now() - oldestOutbox.createdAt.getTime()) / 1000) : 0 },
      calendar: { connections: group(connections), events: group(calendarEvents), meetings: group(meetings) },
      email: { failed: emailFailed, stalePending: emailPending },
      webhooks: { failed: webhooksFailed },
      recentFailures: failedJobs,
    };
  }

  async jobsList(q: AdminJobsQuery) {
    const where: Prisma.JobRecordWhereInput = { ...(q.status ? { status: q.status as Prisma.EnumJobStatusFilter['equals'] } : {}), ...(q.queue ? { queue: q.queue } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.jobRecord.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.jobRecord.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async retryJob(admin: AuthUser, id: string) {
    const rec = await this.prisma.jobRecord.findUnique({ where: { id } });
    if (!rec) throw AppError.notFound('Job');
    if (rec.status !== 'FAILED' && rec.status !== 'DEAD') throw AppError.unprocessable(ErrorCode.CONFLICT, 'Only failed jobs can be retried');
    if (rec.name === JOBS.sendEmail) {
      await this.prisma.notification.updateMany({ where: { id: rec.entityId ?? '', status: 'FAILED' }, data: { status: 'PENDING' } });
    }
    const result = await this.jobs.retry(rec.queue as QueueName, rec.jobKey, rec.name, (rec.payload ?? {}) as Record<string, unknown>);
    await this.prisma.jobRecord.update({ where: { id }, data: { status: 'PENDING', lastError: null } });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.job_retried', entityType: 'JobRecord', entityId: id, metadata: { jobKey: rec.jobKey, result } });
    return { result };
  }

  async webhooks(q: { skip: number; pageSize: number; page: number }, failedOnly: boolean) {
    const where: Prisma.WebhookEventWhereInput = failedOnly ? { processedAt: null } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.webhookEvent.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: q.skip, take: q.pageSize, select: { id: true, provider: true, eventId: true, eventType: true, processedAt: true, error: true, receivedAt: true } }),
      this.prisma.webhookEvent.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  // ---------- Templates ----------
  async templates() {
    const stored = await this.prisma.notificationTemplate.findMany();
    return TEMPLATE_DEFAULTS.map((d) => {
      const s = stored.find((x) => x.key === d.key);
      return { key: d.key, description: d.description, category: d.category, mandatory: d.mandatory, subject: s?.subject ?? d.subject, htmlBody: s?.htmlBody ?? d.html, textBody: s?.textBody ?? d.text, customized: Boolean(s), updatedAt: s?.updatedAt ?? null, variables: referencedVariables(d.subject + d.html + d.text) };
    });
  }

  async updateTemplate(admin: AuthUser, key: string, dto: UpdateTemplateDto) {
    const def = TEMPLATE_BY_KEY.get(key);
    if (!def) throw AppError.notFound('Template');
    const allowed = new Set([...referencedVariables(def.subject + def.html + def.text), 'prefsUrl']);
    const unknown = referencedVariables(dto.subject + dto.htmlBody + dto.textBody).filter((v) => !allowed.has(v));
    if (unknown.length) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `Unknown variables: ${unknown.join(', ')}`, { allowed: [...allowed] });
    if (/<script|javascript:|on\w+\s*=/i.test(dto.htmlBody)) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Scripts and event handlers are not allowed in email templates');
    await this.prisma.notificationTemplate.upsert({
      where: { key },
      create: { key, description: def.description, subject: dto.subject, htmlBody: dto.htmlBody, textBody: dto.textBody, updatedById: admin.id },
      update: { subject: dto.subject, htmlBody: dto.htmlBody, textBody: dto.textBody, updatedById: admin.id },
    });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.template_updated', entityType: 'NotificationTemplate', entityId: key });
    return (await this.templates()).find((t) => t.key === key);
  }

  async resetTemplate(admin: AuthUser, key: string) {
    await this.prisma.notificationTemplate.deleteMany({ where: { key } });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.template_reset', entityType: 'NotificationTemplate', entityId: key });
  }

  previewTemplate(key: string) {
    if (!TEMPLATE_BY_KEY.has(key)) throw AppError.notFound('Template');
    return this.emailSender.renderEmail(key, SAMPLE_CONTEXT);
  }

  // ---------- Audit ----------
  async auditLogs(q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize, include: { actor: { select: { email: true, fullName: true } } } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  // ---------- Support ----------
  async tickets(q: TicketsQuery) {
    const where: Prisma.SupportTicketWhereInput = q.status ? { status: q.status as Prisma.EnumSupportTicketStatusFilter['equals'] } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.supportTicket.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  async updateTicket(admin: AuthUser, id: string, status: string, adminNote?: string) {
    const t = await this.prisma.supportTicket.update({ where: { id }, data: { status: status as 'OPEN', adminNote } }).catch(() => {
      throw AppError.notFound('Ticket');
    });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.ticket_updated', entityType: 'SupportTicket', entityId: id, metadata: { status } });
    return t;
  }
}
