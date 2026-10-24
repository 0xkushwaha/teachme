import { BookingStatus } from '@prisma/client';

/**
 * Booking state machine. Every status change goes through `assertTransition`.
 *
 *  PENDING_PAYMENT ──pay verified──▶ CONFIRMED ──session ends──▶ COMPLETED
 *        │  │                            │
 *        │  └─hold expired─▶ EXPIRED ─────┤ (late capture, slot still free → CONFIRMED)
 *        │  └─hold expired, last attempt failed─▶ PAYMENT_FAILED ─▶ CONFIRMED (late capture)
 *        └─student abandons─▶ CANCELLED    └─cancel─▶ CANCELLED
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: ['CONFIRMED', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED'],
  EXPIRED: ['CONFIRMED'],
  PAYMENT_FAILED: ['CONFIRMED'],
  CONFIRMED: ['CANCELLED', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** Statuses that occupy the teacher's calendar (mirrors the DB exclusion constraint predicate). */
export const SLOT_HOLDING_STATUSES: readonly BookingStatus[] = ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED'];

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: BookingStatus,
    readonly to: BookingStatus,
  ) {
    super(`Booking cannot move from ${from} to ${to}`);
  }
}

export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
