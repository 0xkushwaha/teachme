import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthedRequest } from './auth.guard';

/** Rate-limit per authenticated user when known, otherwise per client IP. */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as AuthedRequest;
    return r.user?.id ? `u:${r.user.id}` : `ip:${r.ip}`;
  }
}
