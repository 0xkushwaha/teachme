/**
 * Money helpers. All amounts are integer minor units (paise). No floating point is
 * used for monetary values: rates are basis points (1 bp = 0.01%).
 */

/** Integer division rounding half away from zero, for non-negative numerators. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('divRoundHalfUp requires safe integers and a positive denominator');
  }
  if (numerator < 0) throw new RangeError('negative amounts are not supported');
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

export function applyBps(amountMinor: number, bps: number): number {
  return divRoundHalfUp(amountMinor * bps, 10_000);
}

export interface PricingPolicy {
  platformFeeBps: number;
  taxBps: number;
  /** What the tax rate applies to. */
  taxBase: 'PLATFORM_FEE' | 'SUBTOTAL';
}

export interface PriceBreakdown {
  priceMinor: number;
  platformFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export function calculatePrice(hourlyRateMinor: number, durationMinutes: number, policy: PricingPolicy): PriceBreakdown {
  if (!Number.isInteger(hourlyRateMinor) || hourlyRateMinor <= 0) throw new RangeError('invalid hourly rate');
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) throw new RangeError('invalid duration');
  const priceMinor = divRoundHalfUp(hourlyRateMinor * durationMinutes, 60);
  const platformFeeMinor = applyBps(priceMinor, policy.platformFeeBps);
  const taxable = policy.taxBase === 'SUBTOTAL' ? priceMinor + platformFeeMinor : platformFeeMinor;
  const taxMinor = applyBps(taxable, policy.taxBps);
  return { priceMinor, platformFeeMinor, taxMinor, totalMinor: priceMinor + platformFeeMinor + taxMinor };
}

export function formatMinor(amountMinor: number, currency = 'INR'): string {
  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${major.toLocaleString('en-IN')}${minor ? `.${String(minor).padStart(2, '0')}` : ''}`;
}
