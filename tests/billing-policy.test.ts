import { describe, expect, it } from 'vitest';
import { FREE_TRIAL_CAPTCHA_LIMIT, quotaAllows, consumeApiRateLimit } from '../src/server/billing.ts';

describe('account-level CAPTCHA quota policy', () => {
  it('sets the lifetime free allowance to exactly 20 challenges per account', () => {
    expect(FREE_TRIAL_CAPTCHA_LIMIT).toBe(20);
  });

  it('allows the final free challenge and blocks the next one', () => {
    expect(quotaAllows(19, FREE_TRIAL_CAPTCHA_LIMIT)).toBe(true);
    expect(quotaAllows(20, FREE_TRIAL_CAPTCHA_LIMIT)).toBe(false);
  });

  it('counts a challenge once regardless of verification retries', () => {
    expect(quotaAllows(99_999, 100_000, 1)).toBe(true);
    expect(quotaAllows(100_000, 100_000, 1)).toBe(false);
  });

  it('rejects invalid quota values instead of accidentally allowing usage', () => {
    expect(quotaAllows(-1, 20)).toBe(false);
    expect(quotaAllows(0, -1)).toBe(false);
    expect(quotaAllows(0, 20, 0)).toBe(false);
    expect(quotaAllows(0.5, 20)).toBe(false);
  });
});

describe('rate limit policy', () => {
  it('enforces the configured limit across repeated requests in a fixed window', async () => {
    const uniqueKey = `test-rate-limit-${Date.now()}-${Math.random()}`;
    const first = await consumeApiRateLimit(uniqueKey, 2, 60_000);
    const second = await consumeApiRateLimit(uniqueKey, 2, 60_000);
    const third = await consumeApiRateLimit(uniqueKey, 2, 60_000);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
  });
});
