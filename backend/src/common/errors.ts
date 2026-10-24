import { HttpException, HttpStatus } from '@nestjs/common';

/** Stable, documented error codes returned in `error.code`. See docs/api.md. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  CSRF_INVALID: 'CSRF_INVALID',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  TOKEN_INVALID: 'TOKEN_INVALID',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  BOOKING_INVALID_STATE: 'BOOKING_INVALID_STATE',
  BOOKING_POLICY_VIOLATION: 'BOOKING_POLICY_VIOLATION',
  TEACHER_UNAVAILABLE: 'TEACHER_UNAVAILABLE',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  PAYMENT_PROVIDER_ERROR: 'PAYMENT_PROVIDER_ERROR',
  INTEGRATION_NOT_CONFIGURED: 'INTEGRATION_NOT_CONFIGURED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: HttpStatus,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(what = 'Resource') {
    return new AppError(ErrorCode.NOT_FOUND, `${what} not found`, HttpStatus.NOT_FOUND);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new AppError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static unauthenticated(message = 'Authentication required') {
    return new AppError(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);
  }
  static conflict(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }
  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }
  static unprocessable(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }
  static notConfigured(integration: string) {
    return new AppError(
      ErrorCode.INTEGRATION_NOT_CONFIGURED,
      `${integration} is not configured on this server`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
