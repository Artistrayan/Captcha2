import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import {
  FREE_TRIAL_CAPTCHA_LIMIT,
  matchesTronUsdtTransferEvent,
  quotaAllows,
  consumeApiRateLimit,
} from '../src/server/billing.ts';

describe('billing and usage guardrails', () => {
  it('keeps the free trial cap at twenty challenges per account', () => {
    expect(FREE_TRIAL_CAPTCHA_LIMIT).toBe(20);
  });

  it('enforces quota boundaries without allowing invalid counters', () => {
    expect(quotaAllows(19, 20)).toBe(true);
    expect(quotaAllows(20, 20)).toBe(false);
    expect(quotaAllows(0, 1)).toBe(true);
    expect(quotaAllows(-1, 20)).toBe(false);
    expect(quotaAllows(0, -1)).toBe(false);
    expect(quotaAllows(19, 20, 2)).toBe(false);
    expect(quotaAllows(19, 20, 1.5)).toBe(false);
  });

  it('enforces a shared fixed-window rate limit for repeated keys', async () => {
    const key = `test-rate-limit:${crypto.randomUUID()}`;
    const first = await consumeApiRateLimit(key, 1, 60_000);
    const second = await consumeApiRateLimit(key, 1, 60_000);

    expect(first.allowed).toBe(true);
    expect(first.count).toBe(1);
    expect(second.allowed).toBe(false);
    expect(second.count).toBe(2);
    expect(second.resetAt).toBe(first.resetAt);
  });

  it('accepts only an exact USDT TRC20 transfer event for the requested invoice', () => {
    const event = {
      transaction_id: 'a'.repeat(64),
      contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      event_name: 'Transfer',
      result: { to: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', value: '9000000' },
    };

    expect(matchesTronUsdtTransferEvent(
      event,
      'A'.repeat(64),
      'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE',
      9_000_000n,
    )).toBe(true);
    expect(matchesTronUsdtTransferEvent(event, 'b'.repeat(64), 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 9_000_000n)).toBe(false);
    expect(matchesTronUsdtTransferEvent(event, 'a'.repeat(64), 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 1n)).toBe(false);
    expect(matchesTronUsdtTransferEvent({ ...event, contract_address: 'not-usdt' }, 'a'.repeat(64), 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 9_000_000n)).toBe(false);
  });
});
