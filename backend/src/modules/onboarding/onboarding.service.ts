import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { isUniqueViolation } from '../../database/prisma-errors';
import { AppError, ErrorCode } from '../../common/errors';
import type { AuthUser } from '../../common/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { AuditService } from '../../services/audit.service';
import { OutboxService } from '../../services/outbox.service';
import { SettingsService } from '../../services/settings.service';
import { randomToken, sha256 } from '../../utils/crypto';
import { slugify } from '../../utils/slug';
import { isValidTimezone } from '../../utils/time';
import type { ClientInfo } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { FILE_META, FilesService, UploadedBlob } from '../files/files.service';
import { AcceptInvitationDto, InvitationsQuery, UploadDocumentDto } from './dto/onboarding.dto';

const RESEND_COOLDOWN_MS = 60_000;
const MAX_SENDS = 10;

type InvitationRow = Prisma.TeacherInvitationGetPayload<object>;

/** An invitation past its expiry is reported as EXPIRED even before a write records it. */
function effectiveStatus(i: Pick<InvitationRow, 'status' | 'expiresAt'>, now = new Date()) {
  return i.status === 'PENDING' && i.expiresAt <= now ? 'EXPIRED' : i.status;
}

function toInvitationView(i: InvitationRow) {
  return {
    id: i.id,
    email: i.email,
    status: effectiveStatus(i),
    expiresAt: i.expiresAt,
    note: i.note,
    sendCount: i.sendCount,
    lastSentAt: i.lastSentAt,
    deliveredAt: i.deliveredAt,
    lastDeliveryError: i.lastDeliveryError,
    acceptedAt: i.acceptedAt,
    acceptedUserId: i.acceptedUserId,
    revokedAt: i.revokedAt,
    createdAt: i.createdAt,
  };
}

/**
 * Teacher invitations and onboarding: the only path to a TEACHER account when open applications
 * are closed, plus document upload, avatar upload and application submission.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly passwords: PasswordService,
    private readonly files: FilesService,
  ) {}

  // ---------------- Invitations (admin) ----------------

  async invite(admin: AuthUser, email: string, note?: string) {
    const existing = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (existing) throw AppError.conflict(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
    const { invitationTtlHours } = await this.settings.get('onboarding.rules');
    const token = randomToken(32);
    try {
      const inv = await this.prisma.$transaction(async (tx) => {
        await tx.teacherInvitation.updateMany({
          where: { email: { equals: email, mode: 'insensitive' }, status: 'PENDING', expiresAt: { lte: new Date() } },
          data: { status: 'EXPIRED' },
        });
        const created = await tx.teacherInvitation.create({
          data: { email, tokenHash: sha256(token), expiresAt: new Date(Date.now() + invitationTtlHours * 3_600_000), invitedById: admin.id, note: note || null },
        });
        await this.outbox.publish(tx, { type: 'teacher.invited', aggregateId: created.id, payload: { invitationId: created.id, token } });
        await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.teacher_invited', entityType: 'TeacherInvitation', entityId: created.id, metadata: { email } }, tx);
        return created;
      });
      return toInvitationView(inv);
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict(ErrorCode.CONFLICT, 'This email already has an active invitation. Resend it instead.');
      throw err;
    }
  }

  async list(q: InvitationsQuery) {
    const now = new Date();
    const statusWhere: Prisma.TeacherInvitationWhereInput =
      q.status === 'PENDING' ? { status: 'PENDING', expiresAt: { gt: now } }
      : q.status === 'EXPIRED' ? { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lte: now } }] }
      : q.status ? { status: q.status }
      : {};
    const where: Prisma.TeacherInvitationWhereInput = { ...statusWhere, ...(q.q ? { email: { contains: q.q, mode: 'insensitive' } } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.teacherInvitation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.teacherInvitation.count({ where }),
    ]);
    return paginate(rows.map(toInvitationView), total, q);
  }

  /** Issues a fresh token (the old link stops working) and extends the expiry. */
  async resend(admin: AuthUser, id: string) {
    const inv = await this.prisma.teacherInvitation.findUnique({ where: { id } });
    if (!inv) throw AppError.notFound('Invitation');
    if (inv.status !== 'PENDING' && inv.status !== 'EXPIRED')
      throw AppError.unprocessable(ErrorCode.CONFLICT, `An ${inv.status.toLowerCase()} invitation cannot be resent`);
    if (inv.sendCount >= MAX_SENDS) throw AppError.unprocessable(ErrorCode.CONFLICT, 'This invitation has been sent too many times. Revoke it and create a new one.');
    if (Date.now() - inv.lastSentAt.getTime() < RESEND_COOLDOWN_MS)
      throw new AppError(ErrorCode.RATE_LIMITED, 'Please wait a minute before resending', HttpStatus.TOO_MANY_REQUESTS);
    if (await this.prisma.user.findFirst({ where: { email: { equals: inv.email, mode: 'insensitive' } }, select: { id: true } }))
      throw AppError.conflict(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
    const { invitationTtlHours } = await this.settings.get('onboarding.rules');
    const token = randomToken(32);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const res = await tx.teacherInvitation.updateMany({
          where: { id, status: inv.status, sendCount: inv.sendCount },
          data: {
            status: 'PENDING',
            tokenHash: sha256(token),
            expiresAt: new Date(Date.now() + invitationTtlHours * 3_600_000),
            sendCount: { increment: 1 },
            lastSentAt: new Date(),
            deliveredAt: null,
            lastDeliveryError: null,
          },
        });
        if (res.count !== 1) throw AppError.conflict(ErrorCode.CONFLICT, 'The invitation changed; refresh and try again');
        await this.outbox.publish(tx, { type: 'teacher.invited', aggregateId: id, payload: { invitationId: id, token } });
        await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.teacher_invitation_resent', entityType: 'TeacherInvitation', entityId: id }, tx);
        return tx.teacherInvitation.findUniqueOrThrow({ where: { id } });
      });
      return toInvitationView(updated);
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict(ErrorCode.CONFLICT, 'Another active invitation exists for this email');
      throw err;
    }
  }

  async revoke(admin: AuthUser, id: string) {
    const res = await this.prisma.$transaction(async (tx) => {
      const r = await tx.teacherInvitation.updateMany({ where: { id, status: { in: ['PENDING', 'EXPIRED'] } }, data: { status: 'REVOKED', revokedAt: new Date(), revokedById: admin.id } });
      if (r.count === 1) await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.teacher_invitation_revoked', entityType: 'TeacherInvitation', entityId: id }, tx);
      return r.count;
    });
    if (res !== 1) {
      const exists = await this.prisma.teacherInvitation.count({ where: { id } });
      if (!exists) throw AppError.notFound('Invitation');
      throw AppError.unprocessable(ErrorCode.CONFLICT, 'Only pending invitations can be revoked');
    }
    return toInvitationView(await this.prisma.teacherInvitation.findUniqueOrThrow({ where: { id } }));
  }

  /** Only dead invitations can be deleted: revoke a live one first, and accepted ones stay linked to the account. */
  async removeInvitation(admin: AuthUser, id: string) {
    const inv = await this.prisma.teacherInvitation.findUnique({ where: { id } });
    if (!inv) throw AppError.notFound('Invitation');
    const status = effectiveStatus(inv, new Date());
    if (status !== 'REVOKED' && status !== 'EXPIRED')
      throw AppError.unprocessable(ErrorCode.CONFLICT, 'Only revoked or expired invitations can be deleted');
    await this.prisma.teacherInvitation.delete({ where: { id } });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.teacher_invitation_deleted', entityType: 'TeacherInvitation', entityId: id });
  }

  // ---------------- Invitations (public) ----------------

  async inspect(token: string) {
    const inv = await this.prisma.teacherInvitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!inv || effectiveStatus(inv) !== 'PENDING') throw AppError.badRequest(ErrorCode.TOKEN_INVALID, 'This invitation link is invalid, has expired or has already been used');
    return { email: inv.email, expiresAt: inv.expiresAt };
  }

  /**
   * Creates the TEACHER account. The invitation is claimed with a compare-and-set in the same
   * transaction, so a token can be used once even under concurrent submissions.
   */
  async accept(dto: AcceptInvitationDto, client: ClientInfo) {
    const tokenHash = sha256(dto.token);
    const invalid = () => AppError.badRequest(ErrorCode.TOKEN_INVALID, 'This invitation link is invalid, has expired or has already been used');
    const inv = await this.prisma.teacherInvitation.findUnique({ where: { tokenHash } });
    if (!inv || effectiveStatus(inv) !== 'PENDING') throw invalid();
    const timezone = dto.timezone && isValidTimezone(dto.timezone) ? dto.timezone : 'Asia/Kolkata';
    const passwordHash = await this.passwords.hash(dto.password);
    const now = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.teacherInvitation.updateMany({ where: { id: inv.id, tokenHash, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', acceptedAt: now } });
        if (claimed.count !== 1) throw invalid();
        const user = await tx.user.create({
          data: {
            email: inv.email.toLowerCase(),
            passwordHash,
            fullName: dto.fullName,
            role: 'TEACHER',
            timezone,
            // The invitation link was delivered to this inbox, which proves control of the address.
            emailVerifiedAt: now,
            privacyConsentAt: now,
            teacherProfile: {
              create: {
                slug: `${slugify(dto.fullName) || 'teacher'}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                headline: '',
                bio: '',
                timezone,
                languages: ['English'],
              },
            },
          },
          include: { teacherProfile: { select: { id: true } } },
        });
        await tx.teacherInvitation.update({ where: { id: inv.id }, data: { acceptedUserId: user.id } });
        await this.outbox.publish(tx, { type: 'teacher.registered', aggregateId: user.teacherProfile!.id, payload: { teacherId: user.teacherProfile!.id } });
        await this.audit.record({ actorId: user.id, actorRole: 'TEACHER', action: 'auth.register_invited_teacher', entityType: 'User', entityId: user.id, metadata: { invitationId: inv.id }, ...client }, tx);
        return user;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists. Sign in instead.');
      throw err;
    }
  }

  // ---------------- Documents & avatar (teacher) ----------------

  documents(teacherId: string) {
    return this.prisma.teacherDocument.findMany({
      where: { teacherId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, type: true, title: true, reviewStatus: true, reviewNote: true, reviewedAt: true, createdAt: true, file: { select: FILE_META } },
    });
  }

  async uploadDocument(user: AuthUser, teacherId: string, file: UploadedBlob | undefined, dto: UploadDocumentDto) {
    const [rules, profile, count] = await Promise.all([
      this.settings.get('onboarding.rules'),
      this.prisma.teacherProfile.findUniqueOrThrow({ where: { id: teacherId }, select: { approvalStatus: true, applicationSubmittedAt: true } }),
      this.prisma.teacherDocument.count({ where: { teacherId } }),
    ]);
    if (profile.approvalStatus === 'PENDING' && profile.applicationSubmittedAt)
      throw AppError.unprocessable(ErrorCode.CONFLICT, 'Your application is under review. You can add documents again once a decision is made.');
    if (count >= rules.maxDocuments) throw AppError.unprocessable(ErrorCode.VALIDATION_FAILED, `You can upload up to ${rules.maxDocuments} documents`);
    const doc = await this.prisma.$transaction(async (tx) => {
      const stored = await this.files.store(tx, user.id, 'TEACHER_DOCUMENT', file!);
      const d = await tx.teacherDocument.create({ data: { teacherId, fileId: stored.id, type: dto.type, title: dto.title } });
      await this.audit.record({ actorId: user.id, actorRole: 'TEACHER', action: 'teacher.document_uploaded', entityType: 'TeacherDocument', entityId: d.id, metadata: { type: dto.type, sizeBytes: stored.sizeBytes, mimeType: stored.mimeType } }, tx);
      return d;
    });
    return (await this.documents(teacherId)).find((d) => d.id === doc.id);
  }

  async deleteDocument(user: AuthUser, teacherId: string, documentId: string) {
    const doc = await this.prisma.teacherDocument.findFirst({ where: { id: documentId, teacherId }, include: { teacher: { select: { approvalStatus: true, applicationSubmittedAt: true } } } });
    if (!doc) throw AppError.notFound('Document');
    if (doc.teacher.approvalStatus === 'PENDING' && doc.teacher.applicationSubmittedAt)
      throw AppError.unprocessable(ErrorCode.CONFLICT, 'Documents cannot be removed while your application is under review');
    if (doc.reviewStatus === 'VERIFIED' && doc.teacher.approvalStatus === 'APPROVED')
      throw AppError.unprocessable(ErrorCode.CONFLICT, 'Verified documents on an approved profile can only be removed by support');
    await this.prisma.$transaction(async (tx) => {
      await tx.storedFile.delete({ where: { id: doc.fileId } }); // cascades to the document row
      await this.audit.record({ actorId: user.id, actorRole: 'TEACHER', action: 'teacher.document_deleted', entityType: 'TeacherDocument', entityId: documentId }, tx);
    });
  }

  /** Streams a document to its owner or an admin. Anyone else gets 404 (no enumeration). */
  async sendDocument(viewer: AuthUser, teacherId: string, documentId: string, res: Response) {
    const doc = await this.prisma.teacherDocument.findFirst({
      where: { id: documentId, teacherId },
      include: { file: { select: { fileName: true, mimeType: true, data: true, sha256: true } } },
    });
    const allowed = viewer.role === 'ADMIN' || (viewer.role === 'TEACHER' && viewer.teacherProfileId === teacherId);
    if (!doc || !allowed) throw AppError.notFound('Document');
    if (viewer.role === 'ADMIN')
      await this.audit.record({ actorId: viewer.id, actorRole: 'ADMIN', action: 'admin.teacher_document_viewed', entityType: 'TeacherDocument', entityId: documentId, metadata: { teacherId } });
    this.files.send(res, doc.file, { inline: false, cache: 'private' });
  }

  async uploadAvatar(user: AuthUser, teacherId: string, file: UploadedBlob | undefined) {
    const result = await this.prisma.$transaction(async (tx) => {
      const stored = await this.files.store(tx, user.id, 'AVATAR', file!);
      const url = `/api/v1/files/avatars/${stored.id}`;
      await tx.teacherProfile.update({ where: { id: teacherId }, data: { avatarUrl: url } });
      // Old photos are removed so they stop being publicly reachable.
      await tx.storedFile.deleteMany({ where: { ownerId: user.id, kind: 'AVATAR', id: { not: stored.id } } });
      await this.audit.record({ actorId: user.id, actorRole: 'TEACHER', action: 'teacher.avatar_updated', entityType: 'TeacherProfile', entityId: teacherId }, tx);
      return url;
    });
    return { avatarUrl: result };
  }

  async removeAvatar(user: AuthUser, teacherId: string) {
    await this.prisma.$transaction([
      this.prisma.teacherProfile.update({ where: { id: teacherId }, data: { avatarUrl: null } }),
      this.prisma.storedFile.deleteMany({ where: { ownerId: user.id, kind: 'AVATAR' } }),
    ]);
    return { avatarUrl: null };
  }

  // ---------------- Application (teacher) ----------------

  async application(teacherId: string) {
    const [rules, t] = await Promise.all([
      this.settings.get('onboarding.rules'),
      this.prisma.teacherProfile.findUniqueOrThrow({
        where: { id: teacherId },
        select: {
          approvalStatus: true,
          applicationSubmittedAt: true,
          rejectionReason: true,
          headline: true,
          bio: true,
          avatarUrl: true,
          user: { select: { emailVerifiedAt: true } },
          _count: { select: { subjects: { where: { isActive: true } }, availability: true, documents: true } },
        },
      }),
    ]);
    const checklist = {
      emailVerified: Boolean(t.user.emailVerifiedAt),
      profile: t.headline.length >= 10 && t.bio.length >= 50,
      subjects: t._count.subjects > 0,
      availability: t._count.availability > 0,
      documents: !rules.requireDocuments || t._count.documents > 0,
    };
    const underReview = t.approvalStatus === 'PENDING' && Boolean(t.applicationSubmittedAt);
    const open = t.approvalStatus === 'PENDING' || t.approvalStatus === 'REJECTED';
    return {
      status: t.approvalStatus,
      submittedAt: t.applicationSubmittedAt,
      rejectionReason: t.approvalStatus === 'REJECTED' ? t.rejectionReason : null,
      underReview,
      requireDocuments: rules.requireDocuments,
      documentCount: t._count.documents,
      hasPhoto: Boolean(t.avatarUrl),
      checklist,
      canSubmit: open && !underReview && Object.values(checklist).every(Boolean),
    };
  }

  async submitApplication(user: AuthUser, teacherId: string) {
    const state = await this.application(teacherId);
    if (state.underReview) throw AppError.unprocessable(ErrorCode.CONFLICT, 'Your application is already under review');
    if (state.status !== 'PENDING' && state.status !== 'REJECTED')
      throw AppError.unprocessable(ErrorCode.CONFLICT, `Your profile is ${state.status.toLowerCase()}; there is nothing to submit`);
    const missing = Object.entries(state.checklist).filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length) throw AppError.unprocessable(ErrorCode.VALIDATION_FAILED, `Complete these steps first: ${missing.join(', ')}`, { missing });
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.teacherProfile.updateMany({
        where: { id: teacherId, approvalStatus: state.status, applicationSubmittedAt: state.submittedAt },
        data: { approvalStatus: 'PENDING', applicationSubmittedAt: new Date(), rejectionReason: null },
      });
      if (res.count !== 1) throw AppError.conflict(ErrorCode.CONFLICT, 'Your application changed; refresh and try again');
      // Documents rejected in a previous review go back to the queue with the new submission.
      await tx.teacherDocument.updateMany({ where: { teacherId, reviewStatus: 'REJECTED' }, data: { reviewStatus: 'PENDING' } });
      await this.outbox.publish(tx, { type: 'teacher.application_submitted', aggregateId: teacherId, payload: { teacherId } });
      await this.audit.record({ actorId: user.id, actorRole: 'TEACHER', action: 'teacher.application_submitted', entityType: 'TeacherProfile', entityId: teacherId, metadata: { resubmission: state.status === 'REJECTED' } }, tx);
    });
    return this.application(teacherId);
  }

  // ---------------- Review (admin) ----------------

  async teacherDetail(teacherId: string) {
    const t = await this.prisma.teacherProfile.findUnique({
      where: { id: teacherId },
      include: {
        user: { select: { id: true, email: true, fullName: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true, timezone: true } },
        subjects: { include: { subject: { select: { name: true } } } },
        availability: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] },
        documents: { orderBy: { createdAt: 'asc' }, select: { id: true, type: true, title: true, reviewStatus: true, reviewNote: true, reviewedAt: true, createdAt: true, file: { select: FILE_META } } },
      },
    });
    if (!t) throw AppError.notFound('Topper');
    const now = new Date();
    const [byStatus, recent, earned, openPayout, invitation] = await Promise.all([
      this.prisma.booking.groupBy({ by: ['status'], where: { teacherId }, _count: { _all: true } }),
      this.prisma.booking.findMany({
        where: { teacherId },
        orderBy: { startAt: 'desc' },
        take: 10,
        select: { id: true, startAt: true, status: true, priceMinor: true, durationMinutes: true, subject: { select: { name: true } }, student: { select: { fullName: true } } },
      }),
      this.prisma.teacherEarning.aggregate({ where: { teacherId }, _sum: { amountMinor: true } }),
      this.prisma.teacherPayout.findFirst({ where: { teacherId, status: { in: ['REQUESTED', 'APPROVED'] } }, select: { id: true, status: true, amountMinor: true } }),
      this.prisma.teacherInvitation.findFirst({ where: { acceptedUserId: t.userId }, select: { id: true, createdAt: true, acceptedAt: true } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
    return {
      ...t,
      stats: {
        bookings: counts,
        upcoming: await this.prisma.booking.count({ where: { teacherId, status: 'CONFIRMED', startAt: { gte: now } } }),
        lifetimeEarningsMinor: earned._sum.amountMinor ?? 0,
        openPayout,
      },
      recentBookings: recent,
      invitation,
    };
  }

  async reviewDocument(admin: AuthUser, teacherId: string, documentId: string, status: 'VERIFIED' | 'REJECTED', note?: string) {
    const res = await this.prisma.teacherDocument.updateMany({
      where: { id: documentId, teacherId },
      data: { reviewStatus: status, reviewNote: note ?? null, reviewedAt: new Date(), reviewedById: admin.id },
    });
    if (res.count !== 1) throw AppError.notFound('Document');
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.teacher_document_reviewed', entityType: 'TeacherDocument', entityId: documentId, metadata: { teacherId, status, note: note ?? null } });
    return (await this.documents(teacherId)).find((d) => d.id === documentId);
  }
}
