import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthUser } from '../auth-user';

export const IS_PUBLIC = 'isPublic';
/** Route requires no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restrict route to the given roles (enforced by RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const SKIP_CSRF = 'skipCsrf';
/** Only for server-to-server endpoints authenticated by signature (webhooks). */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);

export const REQUIRE_VERIFIED = 'requireVerified';
/** Route requires a verified email address. */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED, true);

export const IDEMPOTENT = 'idempotent';
/** Route honours the `Idempotency-Key` header (required). */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
