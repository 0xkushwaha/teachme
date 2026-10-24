import type { CookieOptions, Response } from 'express';
import { AppConfig } from '../../config/app-config';
import { randomToken } from '../../utils/crypto';

export const ACCESS_COOKIE = 'tm_at';
export const REFRESH_COOKIE = 'tm_rt';
export const CSRF_COOKIE = 'tm_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const REFRESH_PATH = '/api/v1/auth';

function base(config: AppConfig): CookieOptions {
  return {
    secure: config.env.COOKIE_SECURE,
    sameSite: 'lax',
    domain: config.env.COOKIE_DOMAIN || undefined,
  };
}

export function setAuthCookies(res: Response, config: AppConfig, access: string, refresh: string) {
  res.cookie(ACCESS_COOKIE, access, {
    ...base(config),
    httpOnly: true,
    path: '/',
    maxAge: config.env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, refresh, {
    ...base(config),
    httpOnly: true,
    path: REFRESH_PATH,
    maxAge: config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  ensureCsrfCookie(res, config, undefined, true);
}

/** Double-submit CSRF token: readable by our JS, echoed back in the X-CSRF-Token header. */
export function ensureCsrfCookie(res: Response, config: AppConfig, existing?: string, rotate = false): string {
  const token = !rotate && existing ? existing : randomToken(24);
  res.cookie(CSRF_COOKIE, token, {
    ...base(config),
    httpOnly: false,
    path: '/',
    maxAge: config.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  return token;
}

export function clearAuthCookies(res: Response, config: AppConfig) {
  res.clearCookie(ACCESS_COOKIE, { ...base(config), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(config), path: REFRESH_PATH });
}
