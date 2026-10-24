import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppError, ErrorCode } from '../errors';

/**
 * Uniform error envelope: { error: { code, message, details?, requestId } }.
 * Never leaks stack traces or internal messages for 5xx responses.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL;
    let message = 'An unexpected error occurred. Please try again.';
    let details: unknown;

    if (exception instanceof AppError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = ErrorCode.RATE_LIMITED;
      message = 'Too many requests. Please slow down and try again shortly.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | { message?: unknown };
      const raw = typeof body === 'string' ? body : body.message;
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(raw)) {
        code = ErrorCode.VALIDATION_FAILED;
        message = 'Request validation failed';
        details = raw;
      } else {
        code = statusToCode(status);
        message = typeof raw === 'string' ? raw : message;
      }
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId, path: req.url }, 'Unhandled error');
    }

    res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId } });
  }
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_FAILED;
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    default:
      return status >= 500 ? ErrorCode.INTERNAL : ErrorCode.VALIDATION_FAILED;
  }
}
