import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppConfig } from '../../config/app-config';
import { CSRF_COOKIE, CSRF_HEADER } from '../../modules/auth/cookies';
import { AppError, ErrorCode } from '../errors';
import { SKIP_CSRF } from '../decorators';
import { safeEqual } from '../../utils/crypto';
import type { AuthedRequest } from './auth.guard';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated browsers:
 *  - Origin/Referer must match an allowed origin when present (blocks cross-site form posts), and
 *  - double-submit token: X-CSRF-Token header must equal the tm_csrf cookie.
 * Bearer-token clients are not vulnerable to CSRF and are exempt from the token check.
 * Runs after AuthGuard so `authVia` is known.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_CSRF, [ctx.getHandler(), ctx.getClass()])) return true;
    if (req.authVia === 'bearer') return true;

    const origin = (req.headers.origin as string | undefined) ?? refererOrigin(req.headers.referer);
    const allowed = new Set([...this.config.corsOrigins, new URL(this.config.env.APP_URL).origin, new URL(this.config.env.API_URL).origin]);
    if (origin && !allowed.has(origin)) throw this.fail('Cross-origin request blocked');

    const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
    const header = req.headers[CSRF_HEADER] as string | undefined;
    if (!cookie || !header || !safeEqual(cookie, header)) throw this.fail('Missing or invalid CSRF token');
    return true;
  }

  private fail(message: string) {
    return new AppError(ErrorCode.CSRF_INVALID, message, HttpStatus.FORBIDDEN);
  }
}

function refererOrigin(referer?: string) {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
