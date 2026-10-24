import { CallHandler, ExecutionContext, HttpException, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { from, lastValueFrom, Observable } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';
import { isUniqueViolation } from '../../database/prisma-errors';
import { hashRequest } from '../../utils/crypto';
import { IDEMPOTENT } from '../decorators';
import { AppError, ErrorCode } from '../errors';
import type { AuthedRequest } from '../guards/auth.guard';

const TTL_MS = 24 * 3_600_000;

/**
 * Idempotency-Key support (per user). The first request with a key executes; concurrent
 * duplicates get 409; completed keys replay the stored response; reusing a key with a
 * different payload is rejected. 5xx outcomes release the key so the client may retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, ctx.getHandler())) return next.handle();
    return from(this.run(ctx, next));
  }

  private async run(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = String(req.headers['idempotency-key'] ?? '');
    if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(key))
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'A valid Idempotency-Key header (8-128 chars) is required');
    if (!req.user) throw AppError.unauthenticated();

    const path = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : req.path;
    const requestHash = hashRequest(req.method, req.originalUrl.split('?')[0], req.body);
    let recordId: string;
    try {
      const rec = await this.prisma.idempotencyKey.create({
        data: { userId: req.user.id, key, method: req.method, path, requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
      });
      recordId = rec.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const existing = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: req.user.id, key } } });
      if (!existing) throw AppError.conflict(ErrorCode.IDEMPOTENCY_CONFLICT, 'Please retry the request');
      if (existing.requestHash !== requestHash)
        throw AppError.unprocessable(ErrorCode.IDEMPOTENCY_CONFLICT, 'Idempotency-Key was already used with a different request');
      if (existing.status === 'IN_PROGRESS')
        throw AppError.conflict(ErrorCode.IDEMPOTENCY_CONFLICT, 'An identical request is still being processed');
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.responseStatus ?? 200);
      return existing.responseBody;
    }

    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.prisma.idempotencyKey.update({
        where: { id: recordId },
        data: { status: 'COMPLETED', responseStatus: res.statusCode, responseBody: (body ?? null) as Prisma.InputJsonValue },
      });
      return body;
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
      if (status >= 500 || status === HttpStatus.TOO_MANY_REQUESTS) {
        await this.prisma.idempotencyKey.delete({ where: { id: recordId } }).catch(() => undefined);
      } else {
        const body = { error: (err as HttpException).getResponse() };
        await this.prisma.idempotencyKey.update({
          where: { id: recordId },
          data: { status: 'COMPLETED', responseStatus: status, responseBody: body as Prisma.InputJsonValue },
        });
      }
      throw err;
    }
  }
}
