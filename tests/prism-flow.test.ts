import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { dbRepository } from '../src/db/index.ts';
import { issueCaptchaChallenge } from '../src/captcha/engine.ts';

describe('PrismFlow challenge', () => {
  it('generates a server-stored, short-lived relational challenge when selected', async () => {
    const siteKey = `sc_prism_${crypto.randomBytes(6).toString('hex')}`;
    await dbRepository.createSite({ userId: 'usr_prism_test', name: 'Prism test', siteKey, domains: ['localhost'], secretKeyHash: 'test-hash', secretKeyPrefix: 'test', maskedSecretKey: 'test', challengeDifficulty: 'MEDIUM', invisibleEnabled: true, rateLimitPerMinute: 60 });
    let challenge: Awaited<ReturnType<typeof issueCaptchaChallenge>> | undefined;
    let stored: Awaited<ReturnType<typeof dbRepository.getChallengeByToken>> | null = null;
    for (let i = 0; i < 80; i++) {
      const candidate = await issueCaptchaChallenge(siteKey, 'localhost', 'en');
      const row = await dbRepository.getChallengeByToken(candidate.token);
      if (row?.challengeType === 'PRISM_FLOW') { challenge = candidate; stored = row; break; }
    }
    expect(challenge).toBeDefined();
    expect(stored?.expiresAt).toBeDefined();
    expect(challenge?.options.length).toBe(6);
    expect(challenge?.prompt).toContain('Select the sequence');
    expect(challenge?.options.every(option => option.svg.startsWith('data:image/svg+xml'))).toBe(true);
    expect((challenge as any)?.correctOptionId).toBeUndefined();
  });
});
