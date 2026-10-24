import { applyBps, calculatePrice, divRoundHalfUp, formatMinor } from '../../src/utils/money';

describe('money', () => {
  it('rounds half up with integer arithmetic only', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(1, 3)).toBe(0);
    expect(divRoundHalfUp(2, 3)).toBe(1);
    expect(() => divRoundHalfUp(1.5, 2)).toThrow(RangeError);
    expect(() => divRoundHalfUp(-1, 2)).toThrow(RangeError);
  });

  it('applies basis points', () => {
    expect(applyBps(150000, 500)).toBe(7500);
    expect(applyBps(333, 1800)).toBe(60); // 59.94 → 60
  });

  it('calculates a full breakdown with tax on the platform fee', () => {
    const p = calculatePrice(150000, 60, { platformFeeBps: 500, taxBps: 1800, taxBase: 'PLATFORM_FEE' });
    expect(p).toEqual({ priceMinor: 150000, platformFeeMinor: 7500, taxMinor: 1350, totalMinor: 158850 });
  });

  it('prorates by duration and supports tax on the subtotal', () => {
    const p = calculatePrice(100000, 45, { platformFeeBps: 0, taxBps: 1800, taxBase: 'SUBTOTAL' });
    expect(p.priceMinor).toBe(75000);
    expect(p.taxMinor).toBe(13500);
    expect(p.totalMinor).toBe(88500);
  });

  it('always yields totals equal to the sum of parts (DB check constraint)', () => {
    for (const rate of [12345, 99999, 70001]) {
      for (const d of [30, 45, 60, 90]) {
        const p = calculatePrice(rate, d, { platformFeeBps: 733, taxBps: 1800, taxBase: 'PLATFORM_FEE' });
        expect(p.totalMinor).toBe(p.priceMinor + p.platformFeeMinor + p.taxMinor);
        expect(Number.isInteger(p.totalMinor)).toBe(true);
      }
    }
  });

  it('formats INR', () => {
    expect(formatMinor(158850)).toBe('₹1,588.50');
    expect(formatMinor(100000)).toBe('₹1,000');
  });
});
