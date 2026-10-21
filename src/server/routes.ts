import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { dbRepository, getDatabaseStatus } from '../db/index.ts';
import { getFirebaseStatus, verifyTokenServerSide, getOrCreateUser, createDevSessionToken } from '../auth/firebase.ts';
import { issueCaptchaChallenge, verifyCaptchaResponse, verifyCaptchaReceipt } from '../captcha/engine.ts';
import { checkCaptchaQuota, checkSiteRegistrationQuota, reserveFreeCaptchaTrial, releaseFreeCaptchaTrial } from './billing.ts';

export const apiRouter = Router();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

// In-memory sliding window rate limiter
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

function configuredRateLimit(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 10000
    ? configured
    : fallback;
}

export function rateLimiter(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${req.path}:${ip}`;
    const now = Date.now();

    // Periodically discard expired keys so attacker-controlled IP diversity cannot grow this map forever.
    if (rateLimits.size > 5000) {
      for (const [storedKey, storedEntry] of rateLimits) {
        if (storedEntry.resetAt <= now) rateLimits.delete(storedKey);
      }
    }

    if (rateLimits.size >= 10000 && !rateLimits.has(key)) {
      res.status(429).json({ error: 'Too Many Requests', message: 'Rate limiter capacity reached; retry shortly.', retryAfterMs: windowMs });
      return;
    }

    const entry = rateLimits.get(key);
    if (!entry || entry.resetAt < now) {
      rateLimits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= limit) {
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfterMs: entry.resetAt - now,
      });
      return;
    }

    entry.count++;
    next();
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
    (req as any).user = configuredAdminEmail && verifiedEmail === configuredAdminEmail
      ? { ...user, role: 'ADMIN' }
      : user;
    next();
  } catch (err: any) {
    res.status(401).json({ error: 'Unauthorized', message: err.message || 'Invalid authentication token' });
  }
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
  try {
    // Free accounts receive 10 CAPTCHA challenges total per account. Reservation is atomic
    // and account-wide, so parallel requests or deleting/recreating a site cannot reset it.
    const trial = await reserveFreeCaptchaTrial(parsed.data.siteKey);
    if (trial.isFree && !trial.allowed) {
      res.status(429).json({
        error: 'Free trial allowance exhausted',
        code: 'free-trial-exhausted',
        plan: 'free',
        used: trial.used,
        limit: 10,
        message: parsed.data.lang.toLowerCase().startsWith('fa')
          ? 'اعتبار رایگان آزمایش کپچا تمام شده است. برای ادامه، اشتراک تهیه کنید.'
          : 'Your 10 free CAPTCHA tests are used up. Upgrade to a paid subscription to continue.',
      });
      return;
    }
    if (trial.isFree && trial.allowed) freeTrialReservationUserId = trial.userId;

    // Paid subscriptions use their rolling 30-day request allowance.
    if (!trial.isFree) {
      const quota = await checkCaptchaQuota(parsed.data.siteKey, 2);
      if (!quota.allowed) {
        res.status(429).json({
          error: 'Monthly usage limit reached',
          code: 'usage-limit-exceeded',
          plan: quota.plan,
          used: quota.used,
          limit: quota.limit,
          message: 'The monthly CAPTCHA request allowance has been reached. Upgrade the plan or wait for the rolling 30-day window to renew.',
        });
        return;
      }
    }

    const challenge = await issueCaptchaChallenge(
      parsed.data.siteKey,
      requestDomain,
      parsed.data.lang
    );

    // Keep the reservation only when a challenge was successfully created.
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

  // Enforce the account's rolling usage quota on verification requests too.
  // The challenge is looked up server-side; callers cannot choose another site's quota.
  try {
    const storedChallenge = await dbRepository.getChallengeByToken(parsed.data.token);
    if (storedChallenge) {
      const quota = await checkCaptchaQuota(storedChallenge.siteKey, 1);
      if (!quota.allowed) {
        res.status(429).json({
          success: false,
          score: 0,
          error_codes: ['usage-limit-exceeded'],
          error: 'Monthly usage limit reached',
          plan: quota.plan,
          used: quota.used,
          limit: quota.limit,
          message: 'The monthly CAPTCHA request allowance has been reached. Upgrade the plan or wait for the rolling 30-day window to renew.',
        });
        return;
      }
    }
  } catch (error: any) {
    console.error('[Quota] Verification quota check failed:', error?.message);
    res.status(503).json({
      success: false,
      score: 0,
      error_codes: ['quota-check-unavailable'],
      error: 'Usage quota could not be checked. Please retry shortly.',
    });
    return;
  }

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
      passRatePercent: summary.totalRequests > 0
        ? Math.round((summary.passedRequests / summary.totalRequests) * 100)
        : 0,
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
