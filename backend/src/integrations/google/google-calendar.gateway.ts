import { Injectable } from '@nestjs/common';
import { auth, calendar, calendar_v3 } from '@googleapis/calendar';
import { AppConfig } from '../../config/app-config';
import { AppError } from '../../common/errors';
import {
  CalendarEventInput,
  CalendarEventResult,
  CalendarGateway,
  CalendarProviderError,
  GOOGLE_SCOPES,
  OAuthTokens,
} from './calendar-gateway';

type OAuth2Client = InstanceType<typeof auth.OAuth2>;

const TIMEOUT_MS = 15_000;

/**
 * Google Calendar API v3 via the official `@googleapis/calendar` client.
 * Meet links are created with `conferenceData.createRequest` + `conferenceDataVersion=1`
 * and a unique `requestId`; Google may return the conference as `pending`, in which case
 * the meeting job polls `events.get` until it is `success` or `failure`.
 */
@Injectable()
export class GoogleCalendarGateway implements CalendarGateway {
  constructor(private readonly config: AppConfig) {}

  get configured() {
    return this.config.googleConfigured;
  }

  /**
   * Uses the auth library bundled with @googleapis/calendar (not a separate google-auth-library
   * dependency), so the OAuth client always matches the version the Calendar client expects.
   */
  private oauth(): OAuth2Client {
    if (!this.configured) throw AppError.notConfigured('Google Calendar');
    return new auth.OAuth2(this.config.env.GOOGLE_CLIENT_ID, this.config.env.GOOGLE_CLIENT_SECRET, this.config.env.GOOGLE_REDIRECT_URI);
  }

  private calendar(refreshToken: string): calendar_v3.Calendar {
    const auth = this.oauth();
    auth.setCredentials({ refresh_token: refreshToken });
    return calendar({ version: 'v3', auth, timeout: TIMEOUT_MS });
  }

  buildAuthUrl(state: string, loginHint?: string): string {
    return this.oauth().generateAuthUrl({
      access_type: 'offline',
      // `consent` guarantees a refresh token is returned even on re-connect.
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_SCOPES,
      state,
      login_hint: loginHint,
    });
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const client = this.oauth();
    try {
      const { tokens } = await client.getToken(code);
      let email: string | null = null;
      if (tokens.id_token) {
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: this.config.env.GOOGLE_CLIENT_ID });
        email = ticket.getPayload()?.email ?? null;
      }
      return {
        refreshToken: tokens.refresh_token ?? null,
        accessToken: tokens.access_token ?? null,
        scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
        email,
      };
    } catch (err) {
      throw this.wrap(err);
    }
  }

  async revoke(refreshToken: string) {
    try {
      await this.oauth().revokeToken(refreshToken);
    } catch {
      // Already revoked or expired — nothing more to do.
    }
  }

  async insertEvent(refreshToken: string, input: CalendarEventInput): Promise<CalendarEventResult> {
    try {
      const res = await this.calendar(refreshToken).events.insert({
        calendarId: 'primary',
        conferenceDataVersion: input.conferenceRequestId ? 1 : 0,
        sendUpdates: 'all',
        requestBody: this.body(input),
      });
      return toResult(res.data);
    } catch (err) {
      const wrapped = this.wrap(err);
      // Deterministic event ids make insert idempotent: 409 means a previous attempt succeeded.
      if (wrapped.statusCode === 409) {
        const existing = await this.getEvent(refreshToken, input.eventId);
        if (existing) return existing;
      }
      throw wrapped;
    }
  }

  async getEvent(refreshToken: string, eventId: string): Promise<CalendarEventResult | null> {
    try {
      const res = await this.calendar(refreshToken).events.get({ calendarId: 'primary', eventId });
      return toResult(res.data);
    } catch (err) {
      const wrapped = this.wrap(err);
      if (wrapped.statusCode === 404 || wrapped.statusCode === 410) return null;
      throw wrapped;
    }
  }

  async updateEvent(refreshToken: string, input: CalendarEventInput): Promise<CalendarEventResult> {
    try {
      const res = await this.calendar(refreshToken).events.patch({
        calendarId: 'primary',
        eventId: input.eventId,
        sendUpdates: 'all',
        conferenceDataVersion: 1,
        requestBody: {
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.startIso, timeZone: input.timezone },
          end: { dateTime: input.endIso, timeZone: input.timezone },
          attendees: input.attendees,
          status: 'confirmed',
          ...(input.conferenceRequestId
            ? { conferenceData: { createRequest: { requestId: input.conferenceRequestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
            : {}),
        },
      });
      return toResult(res.data);
    } catch (err) {
      throw this.wrap(err);
    }
  }

  async cancelEvent(refreshToken: string, eventId: string) {
    try {
      await this.calendar(refreshToken).events.delete({ calendarId: 'primary', eventId, sendUpdates: 'all' });
    } catch (err) {
      const wrapped = this.wrap(err);
      if (wrapped.statusCode === 404 || wrapped.statusCode === 410) return;
      throw wrapped;
    }
  }

  private body(input: CalendarEventInput): calendar_v3.Schema$Event {
    return {
      id: input.eventId,
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso, timeZone: input.timezone },
      end: { dateTime: input.endIso, timeZone: input.timezone },
      attendees: input.attendees,
      guestsCanModify: false,
      reminders: { useDefault: true },
      ...(input.conferenceRequestId
        ? {
            conferenceData: {
              createRequest: { requestId: input.conferenceRequestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
            },
          }
        : {}),
    };
  }

  private wrap(err: unknown): CalendarProviderError {
    if (err instanceof CalendarProviderError || err instanceof AppError) return err as CalendarProviderError;
    const e = err as { code?: number | string; status?: number; message?: string; response?: { status?: number; data?: { error?: string } } };
    const status = e.response?.status ?? (typeof e.code === 'number' ? e.code : e.status);
    const oauthError = e.response?.data?.error;
    const revoked = oauthError === 'invalid_grant' || status === 401;
    return new CalendarProviderError(e.message ?? 'Google API request failed', status, revoked);
  }
}

function toResult(ev: calendar_v3.Schema$Event): CalendarEventResult {
  const conf = ev.conferenceData;
  const video = conf?.entryPoints?.find((p) => p.entryPointType === 'video');
  return {
    id: ev.id ?? '',
    status: ev.status ?? 'confirmed',
    htmlLink: ev.htmlLink,
    meet: conf
      ? {
          status: conf.createRequest?.status?.statusCode ?? (video ? 'success' : 'pending'),
          joinUrl: video?.uri ?? ev.hangoutLink ?? null,
          conferenceId: conf.conferenceId ?? null,
        }
      : null,
  };
}
