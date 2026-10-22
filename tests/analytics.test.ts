import { describe, expect, it } from 'vitest';
import { calculatePassRatePercent } from '../src/utils/analytics.ts';

describe('analytics rate calculation', () => {
  it('derives pass rate from the same counts displayed to users', () => {
    expect(calculatePassRatePercent(20, 0)).toBe(0);
    expect(calculatePassRatePercent(20, 4)).toBe(20);
    expect(calculatePassRatePercent(20, 20)).toBe(100);
  });

  it('handles empty or invalid values safely', () => {
    expect(calculatePassRatePercent(0, 0)).toBe(0);
    expect(calculatePassRatePercent(-1, 2)).toBe(0);
    expect(calculatePassRatePercent(20, 25)).toBe(100);
    expect(calculatePassRatePercent(20, -5)).toBe(0);
  });
});
