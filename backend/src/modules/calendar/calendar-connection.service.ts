import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { AppError, ErrorCode } from '../../common/errors';
import { RedisService } from '../../services/redis.service';
import { AuditService } from '../../services/audit.service';
import { SettingsService } from '../../services/settings.service';
import { CALENDAR_GATEWAY, CalendarGateway, GOOGLE_SCOPES } from '../../integrations/google/calendar-gateway';
import { decrypt, encrypt, randomToken, safeEqual } from '../../utils/crypto';

const STATE_TTL_S = 600;
const REQUIRED_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

@Injectable()
export class CalendarConnectionService {
  private readonly logger = new Logger(CalendarConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(CALENDAR_GATEWAY) private readonly gateway: CalendarGateway,
  ) {}

  async status(userId: string) {
    const flags = await this.settings.get('features.flags');
    const conn = await this.prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: 'GOOGLE' } } });
    const failing = conn
      ? await this.prisma.calendarEvent.count({ where: { connectionId: conn.id, status: 'FAILED' } })
      : 0;
    return {
      configured: this.gateway.configured,
      enabled: flags.googleCalendarSync,
      meetEnabled: flags.meetCreation,
      connection: conn
        ? {
            status: conn.status,
            accountEmail: conn.accountEmail,
            scopes: conn.scopes,
            connectedAt: conn.connectedAt,
            lastSyncedAt: conn.lastSyncedAt,
            lastError: conn.lastError,
            failingEvents: failing,
          }
        : null,
      requiredScopes: GOOGLE_SCOPES,
    };
  }

  /** Step 1: create single-use state bound to this user (Redis) and this browser (cookie). */
  async start(userId: string, email: string) {
    if (!this.gateway.configured) throw AppError.notConfigured('Google Calendar');
    const state = randomToken(24);
    await this.redis.client.set(`oauth:google:${state}`, JSON.stringify({ userId }), 'EX', STATE_TTL_S);
    return { url: this.gateway.buildAuthUrl(state, email), state };
  }

  /** Step 2: validate state, exchange code, store the refresh token encrypted (AES-256-GCM). */
  async complete(params: { code?: string; state?: string; error?: string; cookieState?: string }) {
    const { code, state, error, cookieState } = params;
    if (error) throw AppError.badRequest(ErrorCode.TOKEN_INVALID, `Google returned: ${error}`);
    if (!code || !state || !cookieState || !safeEqual(state, cookieState))
      throw AppError.badRequest(ErrorCode.TOKEN_INVALID, 'OAuth state mismatch. Please try connecting again.');
    const raw = await this.redis.client.getdel(`oauth:google:${state}`);
    if (!raw) throw AppError.badRequest(ErrorCode.TOKEN_INVALID, 'OAuth session expired. Please try again.');
    const { userId } = JSON.parse(raw) as { userId: string };

    const tokens = await this.gateway.exchangeCode(code);
    if (!tokens.scopes.includes(REQUIRED_SCOPE))
      throw AppError.badRequest(ErrorCode.TOKEN_INVALID, 'Calendar permission was not granted. Please allow calendar access.');

    const existing = await this.prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: 'GOOGLE' } } });
    const refreshToken = tokens.refreshToken ?? (existing ? decrypt(existing.encryptedRefreshToken, this.config.env.DATA_ENCRYPTION_KEY) : null);
    if (!refreshToken) throw AppError.badRequest(ErrorCode.TOKEN_INVALID, 'Google did not return offline access. Please try again.');

    const encryptedRefreshToken = encrypt(refreshToken, this.config.env.DATA_ENCRYPTION_KEY);
    await this.prisma.calendarConnection.upsert({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
      create: { userId, provider: 'GOOGLE', encryptedRefreshToken, scopes: tokens.scopes, accountEmail: tokens.email },
      update: { encryptedRefreshToken, scopes: tokens.scopes, accountEmail: tokens.email, status: 'ACTIVE', lastError: null, revokedAt: null, connectedAt: new Date() },
    });
    await this.audit.record({ actorId: userId, action: 'integration.google_connected', entityType: 'CalendarConnection', entityId: userId });
    return { userId };
  }

  async disconnect(userId: string) {
    const conn = await this.prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: 'GOOGLE' } } });
    if (!conn) return;
    try {
      await this.gateway.revoke(decrypt(conn.encryptedRefreshToken, this.config.env.DATA_ENCRYPTION_KEY));
    } catch (err) {
      this.logger.warn({ err }, 'Token revoke failed');
    }
    await this.prisma.calendarConnection.update({
      where: { id: conn.id },
      data: { status: 'REVOKED', revokedAt: new Date(), encryptedRefreshToken: '' },
    });
    await this.audit.record({ actorId: userId, action: 'integration.google_disconnected', entityType: 'CalendarConnection', entityId: conn.id });
  }

  /** Returns a usable refresh token or null. Never exposed outside the backend. */
  async activeToken(userId: string): Promise<{ connectionId: string; refreshToken: string } | null> {
    const conn = await this.prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: 'GOOGLE' } } });
    if (!conn || conn.status !== 'ACTIVE' || !conn.encryptedRefreshToken) return null;
    return { connectionId: conn.id, refreshToken: decrypt(conn.encryptedRefreshToken, this.config.env.DATA_ENCRYPTION_KEY) };
  }

  async markRevoked(connectionId: string, message: string) {
    await this.prisma.calendarConnection.update({ where: { id: connectionId }, data: { status: 'REVOKED', lastError: message.slice(0, 300) } });
  }

  async markHealthy(connectionId: string) {
    await this.prisma.calendarConnection.update({ where: { id: connectionId }, data: { status: 'ACTIVE', lastError: null, lastSyncedAt: new Date() } });
  }

  async markError(connectionId: string, message: string) {
    await this.prisma.calendarConnection.update({ where: { id: connectionId }, data: { lastError: message.slice(0, 300) } });
  }
}
