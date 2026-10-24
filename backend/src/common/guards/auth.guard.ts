import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { TokenService } from '../../modules/auth/token.service';
import { ACCESS_COOKIE } from '../../modules/auth/cookies';
import { AppError, ErrorCode } from '../errors';
import { IS_PUBLIC, REQUIRE_VERIFIED, ROLES } from '../decorators';
import type { AuthUser } from '../auth-user';
import { HttpStatus } from '@nestjs/common';
import { Role } from '@prisma/client';

export type AuthedRequest = Request & { user?: AuthUser; authVia?: 'cookie' | 'bearer'; sessionId?: string };

/**
 * Global authentication + authorization guard.
 *  1. Resolves the user from the access-token cookie (browser) or Bearer header (API clients).
 *  2. Re-reads the user row so suspensions / role changes apply immediately.
 *  3. Enforces @Roles and @RequireVerifiedEmail metadata.
 * Object-level authorization is enforced in services (e.g. a booking belongs to the caller).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);

    const { token, via } = extractToken(req);
    if (token) {
      const claims = this.tokens.verifyAccess(token);
      if (claims) {
        const user = await this.prisma.user.findUnique({
          where: { id: claims.sub },
          select: { id: true, email: true, role: true, status: true, emailVerifiedAt: true, teacherProfile: { select: { id: true } } },
        });
        if (user && user.status === 'ACTIVE') {
          req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            teacherProfileId: user.teacherProfile?.id ?? null,
            emailVerified: Boolean(user.emailVerifiedAt),
          };
          req.authVia = via;
          req.sessionId = claims.sid;
        }
      }
    }

    if (isPublic) return true;
    if (!req.user) throw AppError.unauthenticated();

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(req.user.role)) throw AppError.forbidden();

    const requireVerified = this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED, targets);
    if (requireVerified && !req.user.emailVerified) {
      throw new AppError(ErrorCode.EMAIL_NOT_VERIFIED, 'Please verify your email address first', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

function extractToken(req: Request): { token?: string; via?: 'cookie' | 'bearer' } {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return { token: header.slice(7), via: 'bearer' };
  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (cookie) return { token: cookie, via: 'cookie' };
  return {};
}
