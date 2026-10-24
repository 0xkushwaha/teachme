import { assertTransition, canTransition, InvalidTransitionError, SLOT_HOLDING_STATUSES } from '../../src/modules/bookings/booking-state';

describe('booking state machine', () => {
  it.each([
    ['PENDING_PAYMENT', 'CONFIRMED'],
    ['PENDING_PAYMENT', 'EXPIRED'],
    ['PENDING_PAYMENT', 'CANCELLED'],
    ['EXPIRED', 'CONFIRMED'],
    ['PAYMENT_FAILED', 'CONFIRMED'],
    ['CONFIRMED', 'CANCELLED'],
    ['CONFIRMED', 'COMPLETED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['CANCELLED', 'CONFIRMED'],
    ['COMPLETED', 'CANCELLED'],
    ['CONFIRMED', 'PENDING_PAYMENT'],
    ['EXPIRED', 'CANCELLED'],
    ['PENDING_PAYMENT', 'COMPLETED'],
  ] as const)('rejects %s → %s', (from, to) => {
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('mirrors the DB exclusion constraint predicate', () => {
    expect([...SLOT_HOLDING_STATUSES].sort()).toEqual(['COMPLETED', 'CONFIRMED', 'PENDING_PAYMENT']);
  });
});
