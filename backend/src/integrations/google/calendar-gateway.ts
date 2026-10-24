/** Boundary over Google OAuth + Calendar API so it can be faked in tests. */
export const CALENDAR_GATEWAY = Symbol('CALENDAR_GATEWAY');

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  // Narrowest scope that allows creating/updating/deleting events (and their Meet conferences).
  'https://www.googleapis.com/auth/calendar.events',
];

export interface OAuthTokens {
  refreshToken: string | null;
  accessToken: string | null;
  scopes: string[];
  email: string | null;
}

export interface CalendarEventInput {
  eventId: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  timezone: string;
  attendees: { email: string; displayName?: string }[];
  /** When set, ask Google to create a Meet conference with this idempotent request id. */
  conferenceRequestId?: string;
}

export interface CalendarEventResult {
  id: string;
  status: string;
  htmlLink?: string | null;
  meet?: {
    /** pending | success | failure */
    status: string;
    joinUrl: string | null;
    conferenceId: string | null;
  } | null;
}

export interface CalendarGateway {
  readonly configured: boolean;
  buildAuthUrl(state: string, loginHint?: string): string;
  exchangeCode(code: string): Promise<OAuthTokens>;
  revoke(refreshToken: string): Promise<void>;
  insertEvent(refreshToken: string, input: CalendarEventInput): Promise<CalendarEventResult>;
  getEvent(refreshToken: string, eventId: string): Promise<CalendarEventResult | null>;
  updateEvent(refreshToken: string, input: CalendarEventInput): Promise<CalendarEventResult>;
  cancelEvent(refreshToken: string, eventId: string): Promise<void>;
}

export class CalendarProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    /** Refresh token revoked/expired: user must reconnect. */
    readonly authRevoked = false,
  ) {
    super(message);
  }
  get retryable() {
    return !this.authRevoked && (!this.statusCode || this.statusCode >= 500 || this.statusCode === 429 || this.statusCode === 403);
  }
}
