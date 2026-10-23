import { describe, expect, it } from 'vitest';
import { FREE_TRIAL_CAPTCHA_LIMIT, FREE_TRIAL_TOTAL_LIMIT, quotaAllows, consumeApiRateLimit, matchesTronUsdtTransferEvent } from '../src/server/billing.ts';

describe('account-level CAPTCHA quota policy', () => {
  it('splits the 20-challenge lifetime allowance into 10 test and 10 production challenges', () => {
    expect(FREE_TRIAL_CAPTCHA_LIMIT).toBe(10);
    expect(FREE_TRIAL_TOTAL_LIMIT).toBe(20);
  });

  it('allows each bucket final challenge and blocks the next one', () => {
    expect(quotaAllows(9, FREE_TRIAL_CAPTCHA_LIMIT)).toBe(true);
    expect(quotaAllows(10, FREE_TRIAL_CAPTCHA_LIMIT)).toBe(false);
  });

  it('enforces the shared 20-challenge cap independently of bucket quotas', () => {
    expect(quotaAllows(19, FREE_TRIAL_TOTAL_LIMIT)).toBe(true);
    expect(quotaAllows(20, FREE_TRIAL_TOTAL_LIMIT)).toBe(false);
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

describe('USDT TRC20 payment matching', () => {
  const txid = 'a'.repeat(64);
  const address = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
  const expectedUnits = 9_000_000n;
  const validEvent = {
    transaction_id: txid.toUpperCase(),
    contract_address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    event_name: 'Transfer',
    result: { to: address, value: expectedUnits.toString() },
  };

  it('accepts only the exact USDT contract, recipient, transaction, and amount', () => {
    expect(matchesTronUsdtTransferEvent(validEvent, txid, address, expectedUnits)).toBe(true);
    expect(matchesTronUsdtTransferEvent({ ...validEvent, contract_address: validEvent.contract_address.toLowerCase() }, txid, address, expectedUnits)).toBe(false);
    expect(matchesTronUsdtTransferEvent({ ...validEvent, result: { ...validEvent.result, to: address.toLowerCase() } }, txid, address, expectedUnits)).toBe(false);
    expect(matchesTronUsdtTransferEvent({ ...validEvent, result: { ...validEvent.result, value: '8999999' } }, txid, address, expectedUnits)).toBe(false);
    expect(matchesTronUsdtTransferEvent({ ...validEvent, transaction_id: 'b'.repeat(64) }, txid, address, expectedUnits)).toBe(false);
  });

  it('rejects malformed token values without throwing', () => {
    expect(matchesTronUsdtTransferEvent({ ...validEvent, result: { ...validEvent.result, value: 'not-a-number' } }, txid, address, expectedUnits)).toBe(false);
  });
});
