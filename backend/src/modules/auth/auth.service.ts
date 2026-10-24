import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Role, TokenType, User } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { isUniqueViolation } from '../../database/prisma-errors';
import { AppError, ErrorCode } from '../../common/errors';
import { AuditService } from '../../services/audit.service';
import { OutboxService } from '../../services/outbox.service';
import { SettingsService } from '../../services/settings.service';
import { randomToken, sha256 } from '../../utils/crypto';
import { isValidTimezone } from '../../utils/time';
import { slugify } from '../../utils/slug';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/auth.dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const VERIFY_TTL_H = 24;
const RESET_TTL_H = 1;
/** Concurrent refreshes from two tabs within this window are not treated as token theft. */
const REFRESH_GRACE_MS = 30_000;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Pre-computed hash used to equalise timing when the email doesn't exist. */
  private dummyHash: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
  ) {
    this.dummyHash = this.passwords.hash(randomToken());
  }

  async register(dto: RegisterDto, client: ClientInfo): Promise<User> {
    const flags = await this.settings.get('features.flags');
    if (dto.role === 'STUDENT' && !flags.studentRegistration)
      throw new AppError(ErrorCode.FEATURE_DISABLED, 'Student registration is currently closed', HttpStatus.FORBIDDEN);
    if (dto.role === 'TEACHER' && !flags.teacherRegistration)
      throw new AppError(ErrorCode.FEATURE_DISABLED, 'Teacher applications are currently closed', HttpStatus.FORBIDDEN);

    const timezone = dto.timezone && isValidTimezone(dto.timezone) ? dto.timezone : 'Asia/Kolkata';
    const passwordHash = await this.passwords.hash(dto.password);
    const token = randomToken();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            fullName: dto.fullName,
            role: dto.role as Role,
            timezone,
            privacyConsentAt: new Date(),
            ...(dto.role === 'STUDENT'
              ? { studentProfile: { create: {} } }
              : {
                  teacherProfile: {
                    create: {
                      slug: `${slugify(dto.fullName) || 'teacher'}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
                      headline: '',
                      bio: '',
                      timezone,
                      languages: ['English'],
                    },
                  },
                }),
          },
        });
        await tx.verificationToken.create({
          data: {
            userId: user.id,
            type: TokenType.EMAIL_VERIFICATION,
            tokenHash: sha256(token),
            expiresAt: new Date(Date.now() + VERIFY_TTL_H * 3_600_000),
          },
        });
        await this.outbox.publish(tx, { type: 'user.registered', aggregateId: user.id, payload: { userId: user.id, token } });
        await this.audit.record(
          { actorId: user.id, actorRole: user.role, action: 'auth.register', entityType: 'User', entityId: user.id, ...client },
          tx,
        );
        return user;
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
      throw err;
    }
  }

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await this.passwords.verify(await this.dummyHash, password);
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect email or password', HttpStatus.UNAUTHORIZED);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(
        ErrorCode.ACCOUNT_LOCKED,
        'Too many failed attempts. Try again later or reset your password.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLoginCount + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : undefined,
        },
      });
      await this.audit.record({ actorId: user.id, action: 'auth.login_failed', entityType: 'User', entityId: user.id, ...client });
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Incorrect email or password', HttpStatus.UNAUTHORIZED);
    }
    if (user.status !== 'ACTIVE') {
      throw new AppError(ErrorCode.ACCOUNT_INACTIVE, 'This account is not active. Contact support.', HttpStatus.FORBIDDEN);
    }

    const rehash = this.passwords.needsRehash(user.passwordHash) ? await this.passwords.hash(password) : undefined;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), ...(rehash ? { passwordHash: rehash } : {}) },
    });
    await this.audit.record({ actorId: user.id, actorRole: user.role, action: 'auth.login', entityType: 'User', entityId: user.id, ...client });
    return this.issue(user, randomUUID(), client);
  }

  private async issue(user: User, familyId: string, client: ClientInfo): Promise<IssuedTokens> {
    const refreshToken = randomToken(48);
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 300),
      },
    });
    const accessToken = this.tokens.signAccess({ sub: user.id, role: user.role, sid: session.id });
    return { accessToken, refreshToken, user };
  }

  /** Rotating refresh tokens with reuse detection: replaying a rotated token revokes the whole family. */
  async refresh(refreshToken: string, client: ClientInfo): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw AppError.unauthenticated('Session expired. Please sign in again.');
    }
    if (session.rotatedAt) {
      if (Date.now() - session.rotatedAt.getTime() > REFRESH_GRACE_MS) {
        await this.prisma.session.updateMany({
          where: { familyId: session.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.audit.record({
          actorId: session.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'Session',
          entityId: session.familyId,
          ...client,
        });
        throw AppError.unauthenticated('Session expired. Please sign in again.');
      }
    } else {
      const claimed = await this.prisma.session.updateMany({
        where: { id: session.id, rotatedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (claimed.count === 0) this.logger.debug('Concurrent refresh within grace window');
    }
    if (session.user.status !== 'ACTIVE') throw AppError.unauthenticated('Account is not active');
    return this.issue(session.user, session.familyId, client);
  }

  async logout(refreshToken: string | undefined, sessionId?: string) {
    if (refreshToken) {
      const s = await this.prisma.session.findUnique({ where: { tokenHash: sha256(refreshToken) } });
      if (s) {
        await this.prisma.session.updateMany({ where: { familyId: s.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        return;
      }
    }
    if (sessionId) await this.prisma.session.updateMany({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async verifyEmail(token: string) {
    const record = await this.consumeToken(token, TokenType.EMAIL_VERIFICATION);
    await this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    await this.audit.record({ actorId: record.userId, action: 'auth.email_verified', entityType: 'User', entityId: record.userId });
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;
    await this.createTokenAndPublish(user.id, TokenType.EMAIL_VERIFICATION, VERIFY_TTL_H, 'user.verification_requested');
  }

  /** Always resolves (no account enumeration). */
  async forgotPassword(email: string, client: ClientInfo) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    await this.createTokenAndPublish(user.id, TokenType.PASSWORD_RESET, RESET_TTL_H, 'user.password_reset_requested');
    await this.audit.record({ actorId: user.id, action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id, ...client });
  }

  async resetPassword(token: string, password: string, client: ClientInfo) {
    const record = await this.consumeToken(token, TokenType.PASSWORD_RESET);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // Proving control of the inbox also verifies the address.
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() },
      }),
      this.prisma.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record({ actorId: record.userId, action: 'auth.password_reset', entityType: 'User', entityId: record.userId, ...client });
  }

  async changePassword(userId: string, current: string, next: string, client: ClientInfo) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, current)))
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Current password is incorrect', HttpStatus.BAD_REQUEST);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.passwords.hash(next) } });
    await this.audit.record({ actorId: userId, action: 'auth.password_changed', entityType: 'User', entityId: userId, ...client });
  }

  private async createTokenAndPublish(
    userId: string,
    type: TokenType,
    ttlHours: number,
    event: 'user.verification_requested' | 'user.password_reset_requested',
  ) {
    const token = randomToken();
    await this.prisma.$transaction(async (tx) => {
      // Invalidate older unused tokens of the same type.
      await tx.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
      await tx.verificationToken.create({
        data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlHours * 3_600_000) },
      });
      await this.outbox.publish(tx, { type: event, aggregateId: userId, payload: { userId, token } });
    });
  }

  private async consumeToken(token: string, type: TokenType) {
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
      throw AppError.badRequest(ErrorCode.TOKEN_INVALID, 'This link is invalid or has expired');
    }
    const claimed = await this.prisma.verificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw AppError.badRequest(ErrorCode.TOKEN_INVALID, 'This link has already been used');
    return record;
  }
}
