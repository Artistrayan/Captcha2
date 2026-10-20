import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { dbRepository, getDatabaseStatus } from '../db/index.ts';
import { getFirebaseStatus, verifyTokenServerSide, getOrCreateUser, createDevSessionToken } from '../auth/firebase.ts';
import { issueCaptchaChallenge, verifyCaptchaResponse } from '../captcha/engine.ts';

export const apiRouter = Router();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);

// In-memory sliding window rate limiter
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitEntry>();

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
    (req as any).user = user;
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
apiRouter.post('/captcha/challenge', rateLimiter(10, 60000), async (req: Request, res: Response) => {
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

  try {
    const challenge = await issueCaptchaChallenge(
      parsed.data.siteKey,
      requestDomain,
      parsed.data.lang
    );

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
apiRouter.post('/captcha/verify', rateLimiter(120, 60000), async (req: Request, res: Response) => {
  const schema = z.object({
    token: z.string().min(1),
    selectedOptionId: z.string().min(1),
    secretKey: z.string().optional(),
    remoteIp: z.string().optional(),
    hostname: z.string().optional(),
    action: z.string().optional(),
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

  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || parsed.data.remoteIp;

  const result = await verifyCaptchaResponse({
    token: parsed.data.token,
    selectedOptionId: parsed.data.selectedOptionId,
    secretKey: parsed.data.secretKey,
    remoteIp: clientIp,
    hostname: parsed.data.hostname || req.hostname,
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
  });
});
