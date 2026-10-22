import { describe, it, expect } from 'vitest';
import { assessCaptchaRisk } from '../src/captcha/risk-engine.ts';

describe('Adaptive anti-bot risk engine', () => {
  it('allows normal browser traffic with a realistic solve time', () => {
    const result = assessCaptchaRisk({ elapsedMs: 4200, attemptsCount: 0, remoteIp: '203.0.113.10', userAgent: 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36', acceptLanguage: 'en-US,en;q=0.9', recentEvents: [] });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.action).toBe('allow');
    expect(result.signals).toEqual([]);
  });
  it('blocks high-confidence browser automation combined with impossible solve speed', () => {
    const result = assessCaptchaRisk({ elapsedMs: 120, userAgent: 'Mozilla/5.0 HeadlessChrome Playwright', acceptLanguage: 'en-US', remoteIp: '203.0.113.11', recentEvents: [] });
    expect(result.score).toBeLessThan(25);
    expect(result.action).toBe('block');
    expect(result.signals).toContain('automation-user-agent');
    expect(result.signals).toContain('impossibly-fast-solve');
  });
  it('blocks only extreme combined risk with repeated failures', () => {
    const now = Date.now();
    const recentEvents = Array.from({ length: 8 }, (_, i) => ({ success: false, score: 0, clientIp: '203.0.113.12', createdAt: new Date(now - i * 1000) }));
    const result = assessCaptchaRisk({ now, elapsedMs: 80, attemptsCount: 3, userAgent: 'python-requests/2.32', acceptLanguage: '', remoteIp: '203.0.113.12', recentEvents });
    expect(result.score).toBeLessThan(25);
    expect(result.action).toBe('block');
    expect(result.signals).toContain('repeated-ip-failures');
  });
  it('defaults normal browser requests to full trust when no risk signals exist', () => {
    const result = assessCaptchaRisk({ userAgent: 'Mozilla/5.0', acceptLanguage: 'en', recentEvents: [] });
    expect(result.score).toBe(100);
    expect(result.action).toBe('allow');
  });
});
