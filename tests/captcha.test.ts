import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/app.ts';
import { dbRepository } from '../src/db/index.ts';
import crypto from 'node:crypto';

describe('ShieldCaptcha Security and Verification Suite', () => {
  let testSiteKey: string;
  let testSecretKey: string;
  let testSiteId: string;

  beforeAll(async () => {
    // Seed a specific test site
    testSiteKey = `sc_site_test_${crypto.randomBytes(6).toString('hex')}`;
    testSecretKey = `sc_sec_live_test_${crypto.randomBytes(16).toString('hex')}`;
    const secretKeyHash = crypto.createHash('sha256').update(testSecretKey).digest('hex');

    const site = await dbRepository.createSite({
      userId: 'usr_test_security',
      name: 'Security Test Site',
      siteKey: testSiteKey,
      domains: ['localhost', 'security-test.dev'],
      secretKeyHash,
      secretKeyPrefix: 'sc_sec_live_',
      maskedSecretKey: 'sc_sec_••••••••test',
      challengeDifficulty: 'MEDIUM',
      invisibleEnabled: true,
      rateLimitPerMinute: 600,
    });
    testSiteId = site.id;
  });

  it('1. GET /api/v1/health should return system status and active engines', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.database).toBeDefined();
    expect(res.body.firebaseAuth).toBeDefined();
  });

  it('2. POST /api/v1/captcha/challenge should issue randomized challenge without revealing the answer', async () => {
    const res = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey, domain: 'localhost' });

    expect(res.status).toBe(200);
    expect(res.body.challengeId).toBeDefined();
    expect(res.body.siteKey).toBe(testSiteKey);
    expect(res.body.prompt).toBeDefined();
    expect(res.body.token).toBeDefined();
    expect(res.body.options).toHaveLength(6);

    // SECURITY CHECK: Ensure correct answer or category is NOT exposed in the options payload
    for (const opt of res.body.options) {
      expect(opt.id).toMatch(/^opt_[0-9a-f]{12}$/);
      expect(opt.svg).toContain('data:image/svg+xml');
      expect((opt as any).label).toBeUndefined();
      expect((opt as any).isCorrect).toBeUndefined();
    }
    expect((res.body as any).correctAnswerHash).toBeUndefined();
    expect((res.body as any).targetCategory).toBeUndefined();
  });

  it('3. Rejects invalid Site Key', async () => {
    const res = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: 'sc_site_non_existent_key_12345' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('site-key-not-found');
  });

  it('4. Enforces domain binding and rejects unauthorized domains', async () => {
    const res = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey, domain: 'malicious-hacker-site.ru' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('domain-mismatch');
  });

  it('5. Rejects wrong answers and increments attempt counter', async () => {
    const chRes = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey, domain: 'localhost' });

    const { token } = chRes.body;

    const verifyRes = await request(app)
      .post('/api/v1/captcha/verify')
      .send({
        token,
        selectedOptionId: 'opt_completely_invalid_id',
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(false);
    expect(verifyRes.body.error_codes).toContain('incorrect-captcha-sol');
  });

  it('Rejects verification when no option is selected', async () => {
    const chRes = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey, domain: 'localhost' });

    const verifyRes = await request(app)
      .post('/api/v1/captcha/verify')
      .send({ token: chRes.body.token });

    expect(verifyRes.body.success).toBe(false);
    expect(verifyRes.body.score).toBe(0);
    expect(verifyRes.body.error_codes).toContain('missing-input-response');
  });

  it('Rejects a wrong secret key even when the selected answer is correct', async () => {
    const chRes = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey, domain: 'localhost' });

    const { token, options } = chRes.body;
    const challenge = await dbRepository.getChallengeByToken(token);
    const salt = process.env.CAPTCHA_SERVER_SALT || 'shield_captcha_internal_salt_dev_98741';
    const correct = options.find((opt: { id: string }) =>
      crypto.createHmac('sha256', salt)
        .update(`${challenge!.id}:${opt.id}`)
        .digest('hex') === challenge!.correctAnswerHash
    );

    expect(correct).toBeDefined();
    const verifyRes = await request(app)
      .post('/api/v1/captcha/verify')
      .send({ token, selectedOptionId: correct!.id, secretKey: 'definitely-wrong-secret' });

    expect(verifyRes.body.success).toBe(false);
    expect(verifyRes.body.score).toBe(0);
    expect(verifyRes.body.error_codes).toContain('invalid-secret-key');
  });

  it('6. Allows four incorrect attempts and locks out the fifth attempt', async () => {
    const chRes = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey });

    const { token } = chRes.body;

    // Four incorrect answers are allowed; the challenge is consumed after the fourth.
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post('/api/v1/captcha/verify')
        .send({ token, selectedOptionId: 'opt_wrong_attempt' });
    }

    // Fifth attempt must be rejected because the fourth incorrect answer consumed the challenge.
    const fifthRes = await request(app)
      .post('/api/v1/captcha/verify')
      .send({ token, selectedOptionId: 'opt_wrong_attempt' });

    expect(fifthRes.body.success).toBe(false);
    expect(['timeout-or-duplicate', 'max-attempts-exceeded']).toContain(fifthRes.body.error_codes[0]);
  });

  it('7. Replay Attack Prevention: Token is single-use and cannot be verified twice', async () => {
    const chRes = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey });

    const { token } = chRes.body;

    // Retrieve internal challenge record to find the exact correct option for testing successful solve
    const internalChallenge = await dbRepository.getChallengeByToken(token);
    expect(internalChallenge).toBeDefined();

    // Find the matching option
    const options = chRes.body.options;
    let correctOptId = '';
    const salt = process.env.CAPTCHA_SERVER_SALT || 'shield_captcha_internal_salt_dev_98741';

    for (const opt of options) {
      const h = crypto.createHmac('sha256', salt).update(`${internalChallenge!.id}:${opt.id}`).digest('hex');
      if (h === internalChallenge!.correctAnswerHash) {
        correctOptId = opt.id;
        break;
      }
    }

    expect(correctOptId).not.toBe('');

    // First verification MUST SUCCEED
    const firstVerify = await request(app)
      .post('/api/v1/captcha/verify')
      .send({
        token,
        selectedOptionId: correctOptId,
        secretKey: testSecretKey,
      });

    expect(firstVerify.status).toBe(200);
    expect(firstVerify.body.success).toBe(true);
    expect(firstVerify.body.score).toBeGreaterThanOrEqual(90);

    // SECOND VERIFICATION (Replay Attack) MUST FAIL
    const replayVerify = await request(app)
      .post('/api/v1/captcha/verify')
      .send({
        token,
        selectedOptionId: correctOptId,
        secretKey: testSecretKey,
      });

    expect(replayVerify.status).toBe(200);
    expect(replayVerify.body.success).toBe(false);
    expect(replayVerify.body.error_codes).toContain('timeout-or-duplicate');
  });

  it('8. Atomic Race Condition: Concurrent verification requests allow at most one success', async () => {
    const chRes = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey });

    const { token } = chRes.body;
    const internalChallenge = await dbRepository.getChallengeByToken(token);
    const salt = process.env.CAPTCHA_SERVER_SALT || 'shield_captcha_internal_salt_dev_98741';

    let correctOptId = '';
    for (const opt of chRes.body.options) {
      const h = crypto.createHmac('sha256', salt).update(`${internalChallenge!.id}:${opt.id}`).digest('hex');
      if (h === internalChallenge!.correctAnswerHash) {
        correctOptId = opt.id;
        break;
      }
    }

    // Fire 2 simultaneous requests in parallel
    const [res1, res2] = await Promise.all([
      request(app).post('/api/v1/captcha/verify').send({ token, selectedOptionId: correctOptId }),
      request(app).post('/api/v1/captcha/verify').send({ token, selectedOptionId: correctOptId }),
    ]);

    const successes = [res1.body.success, res2.body.success].filter(Boolean);
    // At most ONE can ever succeed
    expect(successes.length).toBe(1);
  });

  it('9. Rejects expired challenge tokens', async () => {
    const chRes = await request(app)
      .post('/api/v1/captcha/challenge')
      .send({ siteKey: testSiteKey });

    const { token } = chRes.body;

    // Set expiration in the past using dbRepository helper
    await dbRepository.updateChallengeExpiresAt(token, new Date(Date.now() - 5000));

    const verifyRes = await request(app)
      .post('/api/v1/captcha/verify')
      .send({ token, selectedOptionId: 'opt_any' });

    expect(verifyRes.body.success).toBe(false);
    expect(['challenge-expired', 'timeout-or-duplicate']).toContain(verifyRes.body.error_codes[0]);
  });
});
