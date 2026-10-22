import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { dbRepository, getDatabaseStatus } from '../db/index.ts';
import { getFirebaseStatus, verifyTokenServerSide, getOrCreateUser, createDevSessionToken, createVerifiedFirebaseUser, isEmailRegistered } from '../auth/firebase.ts';
import { issueCaptchaChallenge, verifyCaptchaResponse, verifyCaptchaReceipt } from '../captcha/engine.ts';
import { calculatePassRatePercent } from '../utils/analytics.ts';
import { assessCaptchaRisk } from '../captcha/risk-engine.ts';
import { FREE_TRIAL_CAPTCHA_LIMIT, checkSiteRegistrationQuota, reserveFreeCaptchaTrial, releaseFreeCaptchaTrial, reservePaidCaptchaUsage, completePaidCaptchaUsage, releasePaidCaptchaUsage, consumeApiRateLimit } from './billing.ts';

export const apiRouter = Router();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

// Shared fixed-window rate limiting uses PostgreSQL in production and an in-memory fallback in local development.
function configuredRateLimit(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 10000
    ? configured
    : fallback;
}

export function rateLimiter(limit: number, windowMs: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `api:${req.method}:${req.path}:${ip}`;
    try {
      const result = await consumeApiRateLimit(key, limit, windowMs);
      if (!result.allowed) {
        const retryAfterMs = Math.max(0, result.resetAt - Date.now());
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfterMs,
        });
        return;
      }
      next();
    } catch (error: any) {
      console.error('[RateLimit] Shared rate limiter unavailable:', error?.message || error);
      if (IS_PRODUCTION) {
        res.status(503).json({ error: 'Rate limiting is temporarily unavailable. Please retry shortly.' });
        return;
      }
      next();
    }
  };
}

// Authentication middleware
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing Authorization header' });
    return;
  }

  try {
    const decoded = await verifyTokenServerSide(authHeader);
    const user = await getOrCreateUser(decoded);
    // Initial admin access is determined only from a server-side allowlist and a verified token email.
    const configuredAdminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const verifiedEmail = (decoded.email || '').trim().toLowerCase();
    // The server-side allow-list is the sole authority for admin access. Never trust a
    // persisted role alone, so a stale or accidentally elevated DB role cannot grant admin.
    const isConfiguredAdmin = Boolean(configuredAdminEmail && verifiedEmail === configuredAdminEmail);
    (req as any).user = { ...user, role: isConfiguredAdmin ? 'ADMIN' : 'USER' };
    next();
  } catch (err: any) {
    res.status(401).json({ error: 'Unauthorized', message: err.message || 'Invalid authentication token' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if ((req as any).user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden', message: 'Administrator access required.' });
    return;
  }
  next();
}


// 1. Health check
apiRouter.get('/health', (req: Request, res: Response) => {
  const dbStatus = getDatabaseStatus();
  const firebaseStatus = getFirebaseStatus();

  const isHealthy = (!IS_PRODUCTION || dbStatus.isPostgresConnected) &&
    (!IS_PRODUCTION || firebaseStatus.isInitialized);
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0-mvp',
    database: dbStatus,
    firebaseAuth: firebaseStatus,
    serverMode: process.env.NODE_ENV || 'development',
  });
});

// Administrator-only console APIs. Never return secret hashes or raw CAPTCHA answers.
apiRouter.get('/admin/overview', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [users, sites, tickets, analytics] = await Promise.all([
      dbRepository.getAllUsers(),
      dbRepository.getAllSites(),
      dbRepository.getSupportTickets('', true),
      dbRepository.getGlobalAnalyticsSummary(new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    res.json({
      users: users.length,
      sites: sites.length,
      tickets: tickets.length,
      openTickets: tickets.filter(ticket => ticket.status === 'open' || ticket.status === 'in_progress').length,
      requests24h: analytics.totalRequests,
      passed24h: analytics.passedRequests,
      blocked24h: analytics.blockedRequests,
      passRate24h: calculatePassRatePercent(analytics.totalRequests, analytics.passedRequests),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Admin] Overview failed:', error);
    res.status(500).json({ error: 'Could not load administrator overview.' });
  }
});

apiRouter.get('/admin/users', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const users = await dbRepository.getAllUsers();
    res.json({ users: users.map(user => ({ id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt, updatedAt: user.updatedAt })) });
  } catch (error) {
    console.error('[Admin] Users list failed:', error);
    res.status(500).json({ error: 'Could not load users.' });
  }
});

apiRouter.get('/admin/sites', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [sites, users] = await Promise.all([dbRepository.getAllSites(), dbRepository.getAllUsers()]);
    const ownerEmails = new Map(users.map(user => [user.id, user.email]));
    res.json({ sites: sites.map(site => ({
      id: site.id, userId: site.userId, ownerEmail: ownerEmails.get(site.userId) || 'unknown',
      name: site.name, siteKey: site.siteKey, domains: site.domains, challengeDifficulty: site.challengeDifficulty,
      invisibleEnabled: site.invisibleEnabled, rateLimitPerMinute: site.rateLimitPerMinute, createdAt: site.createdAt,
    })) });
  } catch (error) {
    console.error('[Admin] Sites list failed:', error);
    res.status(500).json({ error: 'Could not load registered websites.' });
  }
});

apiRouter.get('/admin/events', requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const events = await dbRepository.getRecentEvents();
    res.json({ events: events.map(event => ({
      id: event.id, siteKey: event.siteKey, success: event.success, score: event.score,
      hostname: event.hostname, action: event.action, errorCodes: event.errorCodes,
      createdAt: event.createdAt,
    })) });
  } catch (error) {
    console.error('[Admin] Events list failed:', error);
    res.status(500).json({ error: 'Could not load security activity.' });
  }
});


// 2. Development-only session endpoint. Production must use verified Firebase ID tokens.
apiRouter.post('/auth/session', rateLimiter(30, 60000), async (req: Request, res: Response) => {
  if (IS_PRODUCTION) {
    res.status(404).json({ error: 'Not Found', message: 'Development session authentication is disabled in production.' });
    return;
  }
  const bodySchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.format() });
    return;
  }

  const { email, name } = parsed.data;
  let user = await dbRepository.getUserByEmail(email);
  if (!user) {
    user = await dbRepository.createUser({
      firebaseUid: `uid_${crypto.randomBytes(8).toString('hex')}`,
      email,
      name: name || email.split('@')[0],
      role: 'USER',
    });
  }

  const token = createDevSessionToken({
    uid: user.firebaseUid,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});


// Short-lived, hashed email verification codes are persisted so server restarts do not invalidate them.
const hashEmailCode = (email: string, code: string) =>
  crypto.createHash('sha256').update(`${email.toLowerCase()}:${code}:${process.env.SESSION_JWT_SECRET || 'shieldcaptcha-email-code'}`).digest('hex');

apiRouter.post('/auth/email-code/send', rateLimiter(3, 15 * 60 * 1000), async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Invalid email address.' }); return; }
  const email = parsed.data.email.toLowerCase();

  // Do not send a signup verification code to an address that already has an account.
  // Users with existing accounts should use the sign-in flow instead.
  try {
    if (await isEmailRegistered(email)) {
      res.status(409).json({
        error: 'This email already has an account. Please sign in instead.',
        code: 'EMAIL_ALREADY_REGISTERED',
      });
      return;
    }
  } catch (error: any) {
    console.error('[Auth] Existing-email lookup failed:', error?.message || error);
    res.status(503).json({ error: 'Could not check this email right now. Please try again.' });
    return;
  }

  const now = Date.now();
  let previous;
  try {
    previous = await dbRepository.getEmailVerificationCode(email);
  } catch (error) {
    console.error('[Auth] Could not read email verification state:', error);
    res.status(503).json({ error: 'Email verification is temporarily unavailable. Please try again.' }); return;
  }
  if (previous && now - new Date(previous.sentAt).getTime() < 60_000) {
    res.status(429).json({ error: 'Please wait 60 seconds before requesting another code.' }); return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;
  if (!apiKey || !from) {
    res.status(503).json({ error: 'Email verification is not configured yet. The administrator must set RESEND_API_KEY and AUTH_EMAIL_FROM in Render.' }); return;
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  try {
    const mailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your ShieldCaptcha verification code',
        text: `Your ShieldCaptcha verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px"><h2>ShieldCaptcha</h2><p>Your email verification code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p></div>`,
      }),
    });
    if (!mailResponse.ok) {
      const detail = await mailResponse.text();
      console.error('[Auth] Verification email delivery failed:', mailResponse.status, detail.slice(0, 300));
      res.status(502).json({ error: 'Could not send the verification email. Check the email provider configuration.' }); return;
    }
    await dbRepository.upsertEmailVerificationCode({
      email,
      codeHash: hashEmailCode(email, code),
      expiresAt: new Date(now + 10 * 60 * 1000),
      attempts: 0,
      sentAt: new Date(now),
    });
    res.json({ ok: true, message: 'Verification code sent. Check your inbox and spam folder.' });
  } catch (error) {
    console.error('[Auth] Verification email delivery failed:', error);
    res.status(502).json({ error: 'Could not send the verification email.' });
  }
});

apiRouter.post('/auth/email-code/verify', rateLimiter(10, 15 * 60 * 1000), async (req: Request, res: Response) => {
  const parsed = z.object({
    email: z.string().trim().email().max(254),
    code: z.string().regex(/^\d{6}$/),
    password: z.string().min(8).max(128),
    name: z.string().trim().max(80).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Enter a valid email, six-digit code, and password of at least 8 characters.' }); return; }
  const email = parsed.data.email.toLowerCase();
  let record;
  try {
    record = await dbRepository.getEmailVerificationCode(email);
  } catch (error) {
    console.error('[Auth] Could not read email verification state:', error);
    res.status(503).json({ error: 'Email verification is temporarily unavailable. Please try again.' }); return;
  }
  if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
    await dbRepository.deleteEmailVerificationCode(email).catch(() => undefined);
    res.status(400).json({ error: 'The code is missing or expired. Request a new code.' }); return;
  }
  let attemptCount: number | null;
  try {
    attemptCount = await dbRepository.incrementEmailVerificationAttempts(email);
  } catch (error) {
    console.error('[Auth] Could not update email verification attempts:', error);
    res.status(503).json({ error: 'Email verification is temporarily unavailable. Please try again.' }); return;
  }
  if (attemptCount === null) {
    res.status(400).json({ error: 'The code is missing or expired. Request a new code.' }); return;
  }
  if (attemptCount > 5) {
    await dbRepository.deleteEmailVerificationCode(email).catch(() => undefined);
    res.status(429).json({ error: 'Too many incorrect attempts. Request a new code.' }); return;
  }
  const submittedHash = hashEmailCode(email, parsed.data.code);
  const expected = Buffer.from(record.codeHash, 'hex');
  const actual = Buffer.from(submittedHash, 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    res.status(400).json({ error: 'Incorrect verification code.' }); return;
  }
  if (!getFirebaseStatus().isInitialized) {
    res.status(503).json({ error: 'Firebase Admin is not configured.' }); return;
  }
  try {
    const result = await createVerifiedFirebaseUser(email, parsed.data.password, parsed.data.name);
    await dbRepository.deleteEmailVerificationCode(email);
    res.json({ ok: true, customToken: result.customToken, email: result.email });
  } catch (error: any) {
    if (error?.code === 'auth/email-already-exists') {
      await dbRepository.deleteEmailVerificationCode(email);
      res.status(409).json({ error: 'This email already has an account. Please sign in instead.' }); return;
    }
    console.error('[Auth] Verified account creation failed:', error?.message || error);
    res.status(500).json({ error: 'Could not create the account. Please try again.' });
  }
});

// 3. User profile
apiRouter.get('/auth/me', requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

// 4. Create Site (with secure one-time secret key display)
apiRouter.post('/sites', requireAuth, rateLimiter(30, 60000), async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !user.id) {
    res.status(401).json({ error: 'Unauthorized', message: 'User profile not found. Please re-authenticate.' });
    return;
  }

  try {
    const siteQuota = await checkSiteRegistrationQuota(user.id);
    if (!siteQuota.allowed) {
      res.status(403).json({
        error: 'Site registration limit reached',
        code: 'SITE_QUOTA_EXCEEDED',
        message: siteQuota.plan === 'free'
          ? 'The free plan allows 1 registered website. Upgrade to a paid plan to register up to 10 websites.'
          : 'Your plan allows up to 10 registered websites.',
        quota: siteQuota,
      });
      return;
    }
  } catch (quotaError) {
    console.error('[Server] Could not check site registration quota:', quotaError);
    res.status(503).json({ error: 'Could not verify your site registration quota. Please retry.' });
    return;
  }

  const siteSchema = z.object({
    name: z.string().min(2).max(100),
    // Accept hostnames only; do not permit URL paths, schemes, or catch-all wildcards.
    domains: z.array(
      z.string().trim().min(1).max(253).refine(
        domain => domain !== '*' &&
          /^[a-zA-Z0-9.-]+$/.test(domain) &&
          !domain.startsWith('.') &&
          !domain.endsWith('.') &&
          !domain.includes('..'),
        'Each domain must be a hostname without a scheme, path, or wildcard'
      )
    ).min(1).max(50),
    challengeDifficulty: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    invisibleEnabled: z.boolean().default(true),
    rateLimitPerMinute: z.number().int().min(60).max(10000).default(600),
  });

  const parsed = siteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  try {
    // Generate Site Key and Secret Key using CSPRNG
    const siteKey = `sc_site_${crypto.randomBytes(12).toString('hex')}`;
    const rawSecretKey = `sc_sec_live_${crypto.randomBytes(24).toString('base64url')}`;

    // Hash the secret key using SHA-256 for persistent database storage
    const secretKeyHash = crypto.createHash('sha256').update(rawSecretKey).digest('hex');
    const secretKeyPrefix = 'sc_sec_live_';
    const maskedSecretKey = `sc_sec_live_••••••••${rawSecretKey.slice(-4)}`;

    let site;
    try {
      site = await dbRepository.createSite({
        userId: user.id,
        name: parsed.data.name,
        siteKey,
        domains: parsed.data.domains.map(domain => domain.toLowerCase()),
        secretKeyHash,
        secretKeyPrefix,
        maskedSecretKey,
        challengeDifficulty: parsed.data.challengeDifficulty,
        invisibleEnabled: parsed.data.invisibleEnabled,
        rateLimitPerMinute: parsed.data.rateLimitPerMinute,
      });
    } catch (err: any) {
      console.error('[Server] Failed to create site in DB:', err);
      res.status(500).json({ error: 'Internal server error', message: 'Could not create site in database.' });
      return;
    }


    // Return the raw secret key EXACTLY ONCE to the owner! It is never stored or returned again.
    res.status(201).json({
      site: {
        id: site.id,
        name: site.name,
        siteKey: site.siteKey,
        domains: site.domains,
        maskedSecretKey: site.maskedSecretKey,
        challengeDifficulty: site.challengeDifficulty,
        invisibleEnabled: site.invisibleEnabled,
        createdAt: site.createdAt,
      },
      // Sensitive: one-time display!
      oneTimeSecretKey: rawSecretKey,
      securityNotice: 'Save this Secret Key securely now. It will NEVER be shown again.',
    });
  } catch (err: any) {
    console.error('[Create Site Error]', err);
    res.status(500).json({
      error: 'Failed to create site',
      message: err?.message || 'Database error while registering site',
    });
  }
});

// 5. List Sites for authenticated user (Strict User Isolation)
apiRouter.get('/sites', requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const sites = await dbRepository.getSitesByUserId(user.id);

  // Strip internal hash fields before sending
  const sanitizedSites = sites.map(s => ({
    id: s.id,
    name: s.name,
    siteKey: s.siteKey,
    domains: s.domains,
    maskedSecretKey: s.maskedSecretKey,
    challengeDifficulty: s.challengeDifficulty,
    invisibleEnabled: s.invisibleEnabled,
    rateLimitPerMinute: s.rateLimitPerMinute,
    createdAt: s.createdAt,
  }));

  res.json({ sites: sanitizedSites });
});

// 6. Delete Site (Strict Ownership Check)
apiRouter.delete('/sites/:id', requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const siteId = req.params.id;

  const deleted = await dbRepository.deleteSite(siteId, user.id);
  if (!deleted) {
    res.status(404).json({ error: 'Site not found or not authorized' });
    return;
  }

  res.json({ success: true, message: 'Site deleted successfully' });
});

// 7. Issue CAPTCHA Challenge
apiRouter.post('/captcha/challenge', rateLimiter(configuredRateLimit('RATE_LIMIT_CHALLENGES_PER_MIN', 20), 60000), async (req: Request, res: Response) => {
  const schema = z.object({
    siteKey: z.string().min(1),
    domain: z.string().optional(),
    lang: z.string().optional().default('en'),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.format() });
    return;
  }

  // In production, derive the hostname from browser Origin/Referer headers only.
  // Never trust a caller-controlled JSON `domain` field as proof of origin.
  let requestDomain: string | undefined;
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      requestDomain = new URL(origin).hostname;
    } catch {
      requestDomain = undefined;
    }
  }
  if (!IS_PRODUCTION) {
    requestDomain = parsed.data.domain || requestDomain;
  }

  let freeTrialReservationUserId: string | undefined;
  let paidUsageReservationId: string | undefined;
  try {
    // Each account receives 20 free CAPTCHA challenges across all registered websites.
    const trial = await reserveFreeCaptchaTrial(parsed.data.siteKey);
    if (trial.isFree && !trial.allowed) {
      res.status(429).json({
        error: 'Free trial allowance exhausted',
        code: 'free-trial-exhausted',
        plan: 'free',
        used: trial.used,
        limit: FREE_TRIAL_CAPTCHA_LIMIT,
        message: parsed.data.lang.toLowerCase().startsWith('fa')
          ? 'اعتبار رایگان ۲۰ کپچای این حساب تمام شده است. برای ادامه، اشتراک تهیه کنید.'
          : 'Your account has used all 20 free CAPTCHA challenges. Upgrade to a paid subscription to continue.',
      });
      return;
    }
    if (trial.isFree && trial.allowed) freeTrialReservationUserId = trial.userId;

    // A paid challenge reserves exactly one unit, regardless of verification retries.
    if (!trial.isFree) {
      const quota = await reservePaidCaptchaUsage(parsed.data.siteKey);
      if (quota.isPaid && !quota.allowed) {
        res.status(429).json({
          error: 'Monthly usage limit reached',
          code: 'usage-limit-exceeded',
          plan: 'paid',
          used: quota.used,
          limit: quota.limit,
          message: 'The monthly CAPTCHA challenge allowance has been reached. Upgrade the plan or wait for the rolling 30-day window to renew.',
        });
        return;
      }
      paidUsageReservationId = quota.reservationId;
    }

    const recentEvents = await dbRepository.getRecentEvents(parsed.data.siteKey);
    const issueRisk = assessCaptchaRisk({
      remoteIp: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.get('user-agent') || '',
      acceptLanguage: req.get('accept-language') || '',
      recentEvents,
    });
    const challenge = await issueCaptchaChallenge(
      parsed.data.siteKey,
      requestDomain,
      parsed.data.lang,
      IS_PRODUCTION && issueRisk.action !== 'allow'
    );
    if (paidUsageReservationId) {
      await completePaidCaptchaUsage(paidUsageReservationId, challenge.token);
      paidUsageReservationId = undefined;
    }

    // Keep the free reservation only when a challenge was successfully created.
    freeTrialReservationUserId = undefined;
    res.json({
      challengeId: challenge.challengeId,
      siteKey: challenge.siteKey,
      prompt: challenge.prompt,
      options: challenge.options, // Contains randomized opaque IDs + SVGs without solution hints!
      token: challenge.token,
      expiresInSeconds: challenge.expiresInSeconds,
      expiresAt: challenge.expiresAt,
    });
  } catch (err: any) {
    if (freeTrialReservationUserId) {
      await releaseFreeCaptchaTrial(freeTrialReservationUserId).catch(() => undefined);
    }
    if (paidUsageReservationId) {
      await releasePaidCaptchaUsage(paidUsageReservationId).catch(() => undefined);
    }
    if (err.message === 'SITE_KEY_NOT_FOUND') {
      res.status(404).json({ error: 'Invalid Site Key', code: 'site-key-not-found' });
      return;
    }
    if (err.message === 'DOMAIN_MISMATCH' || err.message === 'DOMAIN_REQUIRED') {
      res.status(403).json({ error: 'Domain unauthorized for this site key', code: 'domain-mismatch' });
      return;
    }
    res.status(500).json({ error: 'Internal challenge generation failure' });
  }
});

// 8. Verify CAPTCHA Response
apiRouter.post('/captcha/verify', rateLimiter(configuredRateLimit('RATE_LIMIT_VERIFY_PER_MIN', 30), 60000), async (req: Request, res: Response) => {
  const schema = z.object({
    token: z.string().min(1),
    selectedOptionId: z.string().max(100).optional(),
    secretKey: z.string().min(1).max(512).optional(),
    remoteIp: z.string().max(64).optional(),
    hostname: z.string().max(253).optional(),
    action: z.string().max(128).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      score: 0,
      challenge_ts: new Date().toISOString(),
      hostname: 'unknown',
      action: 'verify',
      development_mode: !IS_PRODUCTION,
      error_codes: ['invalid-request-payload'],
    });
    return;
  }

  // Quota is reserved atomically when a challenge is issued. Verification attempts do not
  // consume extra units, and a challenge issued within quota remains verifiable until expiry.

  // Express resolves req.ip using only the configured trusted proxy chain.
  // Ignore caller-supplied X-Forwarded-For and JSON remoteIp values.
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

  // Hostname supplied in JSON is client-controlled. Prefer browser Origin/Referer
  // when present, and otherwise report the API request host.
  let verifyHostname = req.hostname || 'unknown';
  const verifyOrigin = req.headers.origin || req.headers.referer;
  if (verifyOrigin) {
    try {
      verifyHostname = new URL(verifyOrigin).hostname;
    } catch {
      verifyHostname = 'unknown';
    }
  } else if (!IS_PRODUCTION) {
    verifyHostname = parsed.data.hostname || verifyHostname;
  }

  const result = parsed.data.secretKey
    ? await verifyCaptchaReceipt({
        token: parsed.data.token,
        secretKey: parsed.data.secretKey,
        remoteIp: clientIp,
        hostname: verifyHostname,
        action: parsed.data.action,
      })
    : await verifyCaptchaResponse({
        token: parsed.data.token,
        selectedOptionId: parsed.data.selectedOptionId,
        remoteIp: clientIp,
        hostname: verifyHostname,
        action: parsed.data.action,
        userAgent: req.get('user-agent') || '',
        acceptLanguage: req.get('accept-language') || '',
      });

  res.json(result);
});

// 9. Analytics / Activity logs
apiRouter.get('/analytics/usage', requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const userSites = await dbRepository.getSitesByUserId(user.id);
  const siteKeys = new Set(userSites.map(s => s.siteKey));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const summary = await dbRepository.getAnalyticsSummary([...siteKeys], since);

  res.json({
    summary: {
      totalRequests: summary.totalRequests,
      passedRequests: summary.passedRequests,
      blockedRequests: summary.blockedRequests,
      passRatePercent: calculatePassRatePercent(summary.totalRequests, summary.passedRequests),
    },
    recentEvents: summary.recentEvents.slice(0, 50),
    hourlyTraffic: summary.hourlyTraffic,
  });
});


// 10. Authenticated support tickets. Users can only see their own tickets; admins can triage all.
apiRouter.get('/support/tickets', requireAuth, rateLimiter(60, 60000), async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const tickets = await dbRepository.getSupportTickets(user.id, user.role === 'ADMIN');
    res.json({ tickets, isAdmin: user.role === 'ADMIN' });
  } catch (error) {
    console.error('[Support] Failed to load tickets:', error);
    res.status(503).json({ error: 'Support inbox is temporarily unavailable.' });
  }
});

apiRouter.post('/support/tickets', requireAuth, rateLimiter(10, 60000), async (req: Request, res: Response) => {
  const parsed = z.object({
    subject: z.string().trim().min(4).max(160),
    category: z.enum(['general', 'technical', 'billing', 'security']).default('general'),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    body: z.string().trim().min(10).max(5000),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid support request. Check the subject and message length.' });
    return;
  }
  try {
    const user = (req as any).user;
    const ticket = await dbRepository.createSupportTicket({ userId: user.id, ...parsed.data });
    res.status(201).json({ ticket });
  } catch (error) {
    console.error('[Support] Failed to create ticket:', error);
    res.status(503).json({ error: 'Could not save your support request. Please try again.' });
  }
});

apiRouter.post('/support/tickets/:ticketId/replies', requireAuth, rateLimiter(20, 60000), async (req: Request, res: Response) => {
  const parsed = z.object({
    body: z.string().trim().min(2).max(5000),
    status: z.enum(['open', 'in_progress', 'waiting_user', 'resolved', 'closed']).optional(),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Message must contain between 2 and 5000 characters.' });
    return;
  }
  const user = (req as any).user;
  if (parsed.data.status && user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Only support administrators can change ticket status.' });
    return;
  }
  try {
    const ticket = await dbRepository.replySupportTicket({
      ticketId: req.params.ticketId,
      userId: user.id,
      isAdmin: user.role === 'ADMIN',
      body: parsed.data.body,
      status: parsed.data.status,
    });
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found or closed.' });
      return;
    }
    res.json({ ticket });
  } catch (error) {
    console.error('[Support] Failed to send reply:', error);
    res.status(503).json({ error: 'Could not send your reply. Please try again.' });
  }
});
