import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/app.ts';
import { createDevSessionToken } from '../src/auth/firebase.ts';

describe('Site Management and Multi-Tenant Isolation Suite', () => {
  let userAToken: string;
  let userBToken: string;
  let userASiteId: string;
  let userASiteKey: string;

  beforeAll(async () => {
    userAToken = createDevSessionToken({
      uid: 'user_alice_uid_1',
      email: 'alice@shieldcaptcha.dev',
      name: 'Alice Developer',
    });

    userBToken = createDevSessionToken({
      uid: 'user_bob_uid_2',
      email: 'bob@shieldcaptcha.dev',
      name: 'Bob Competitor',
    });
  });

  it('1. User A can create a new site and receives one-time secret key', async () => {
    const res = await request(app)
      .post('/api/v1/sites')
      .set('Authorization', `Bearer ${userAToken}`)
      .send({
        name: "Alice's E-Commerce Shop",
        domains: ['alice-shop.com', 'localhost'],
        challengeDifficulty: 'HIGH',
        invisibleEnabled: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.site).toBeDefined();
    expect(res.body.site.siteKey).toMatch(/^sc_site_[0-9a-f]{24}$/);
    expect(res.body.oneTimeSecretKey).toMatch(/^sc_sec_live_/);
    expect(res.body.site.maskedSecretKey).toContain('••••••••');
    userASiteId = res.body.site.id;
    userASiteKey = res.body.site.siteKey;
    await dbRepository.recordVerificationEvent({
      siteKey: userASiteKey,
      token: 'test-site-deletion-event',
      success: false,
      score: 0,
      hostname: 'alice-shop.com',
      errorCodes: ['test-event'],
    });
  });

  it('2. GET /api/v1/sites for User A lists their site, masking the secret key', async () => {
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.sites).toBeDefined();
    const site = res.body.sites.find((s: any) => s.id === userASiteId);
    expect(site).toBeDefined();
    expect(site.name).toBe("Alice's E-Commerce Shop");

    // SECURITY CHECK: Secret Key must NOT be disclosed
    expect((site as any).secretKey).toBeUndefined();
    expect((site as any).rawSecretKey).toBeUndefined();
    expect((site as any).secretKeyHash).toBeUndefined();
    expect(site.maskedSecretKey).toContain('••••••••');
  });

  it('3. User Isolation: User B CANNOT see User A’s sites', async () => {
    const res = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(200);
    const sites = res.body.sites || [];
    const hasAliceSite = sites.some((s: any) => s.id === userASiteId);
    expect(hasAliceSite).toBe(false);
  });

  it('4. User Isolation: User B CANNOT delete User A’s site', async () => {
    const res = await request(app)
      .delete(`/api/v1/sites/${userASiteId}`)
      .set('Authorization', `Bearer ${userBToken}`);

    expect(res.status).toBe(404);
  });

  it('5. User A can successfully delete their own site', async () => {
    const res = await request(app)
      .delete(`/api/v1/sites/${userASiteId}`)
      .set('Authorization', `Bearer ${userAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await dbRepository.getRecentEvents(userASiteKey)).toHaveLength(0);

    // Confirm it is gone
    const listRes = await request(app)
      .get('/api/v1/sites')
      .set('Authorization', `Bearer ${userAToken}`);

    const hasSite = (listRes.body.sites || []).some((s: any) => s.id === userASiteId);
    expect(hasSite).toBe(false);
  });
});
