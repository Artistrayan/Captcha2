import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';
import { eq, and, desc, sql, gte, inArray } from 'drizzle-orm';

const { Pool } = pg;

export interface DBStatus {
  isPostgresConnected: boolean;
  engine: 'postgresql' | 'file_persisted_storage';
  databaseUrlConfigured: boolean;
  connectionError?: string;
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
if (IS_PRODUCTION && !process.env.DATABASE_URL) {
  throw new Error('[Database] DATABASE_URL is required in production; refusing to start with local file storage.');
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'shieldcaptcha_db.json');

// Ensure storage directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface PersistentState {
  users: schema.User[];
  sites: schema.Site[];
  apiKeys: Array<{
    id: string;
    siteId: string;
    hashedSecret: string;
    keyPrefix: string;
    createdAt: string;
    lastUsedAt?: string;
    revokedAt?: string;
  }>;
  captchaChallenges: Array<schema.CaptchaChallenge & {
    options: Array<{ id: string; label: string; icon: string }>;
  }>;
  verificationEvents: Array<schema.VerificationEvent & {
    errorCodes: string[];
  }>;
  usageRecords: Array<{
    id: string;
    siteId: string;
    date: string;
    requestsCount: number;
    passedCount: number;
    failedCount: number;
    challengesIssued: number;
  }>;
  auditLogs: Array<{
    id: string;
    userId: string;
    action: string;
    clientIp: string;
    userAgent: string;
    details: Record<string, unknown>;
    createdAt: string;
  }>;
}

function loadState(): PersistentState {
  if (IS_PRODUCTION) {
    throw new Error('[Database] PostgreSQL is unavailable. File-based fallback is disabled in production.');
  }
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch {
      // fallback
    }
  }

  // Initial seed with default developer user and default site
  const defaultUserId = 'usr_dev_default';
  const defaultSiteId = 'site_dev_default';
  const defaultSiteKey = 'sc_site_demo_dev_key';
  const defaultSecret = 'sc_sec_live_dev_secret_demo_key';
  const hashedSecret = crypto.createHash('sha256').update(defaultSecret).digest('hex');

  const initialState: PersistentState = {
    users: [
      {
        id: defaultUserId,
        firebaseUid: 'dev_firebase_uid_1',
        email: 'developer@shieldcaptcha.dev',
        name: 'Shield Admin',
        role: 'ADMIN',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    sites: [
      {
        id: defaultSiteId,
        userId: defaultUserId,
        name: 'Demo Production Site',
        siteKey: defaultSiteKey,
        domains: ['localhost', '127.0.0.1', 'ais-dev-3grw7peea4keqlfvcsn7zj-6902038885.europe-west3.run.app'],
        secretKeyHash: hashedSecret,
        secretKeyPrefix: 'sc_sec_live_',
        maskedSecretKey: 'sc_sec_••••••••demo',
        challengeDifficulty: 'MEDIUM',
        invisibleEnabled: true,
        rateLimitPerMinute: 600,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    apiKeys: [
      {
        id: 'key_dev_default',
        siteId: defaultSiteId,
        hashedSecret,
        keyPrefix: 'sc_sec_live_',
        createdAt: new Date().toISOString(),
      },
    ],
    captchaChallenges: [],
    verificationEvents: [],
    usageRecords: [
      {
        id: 'usage_default',
        siteId: defaultSiteId,
        date: new Date().toISOString().slice(0, 10),
        requestsCount: 142,
        passedCount: 138,
        failedCount: 4,
        challengesIssued: 28,
      },
    ],
    auditLogs: [],
  };

  saveState(initialState);
  return initialState;
}

function saveState(state: PersistentState) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save persistent state to disk:', err);
  }
}

let pgPool: pg.Pool | null = null;
let drizzleDb: ReturnType<typeof drizzle> | null = null;
let isPgConnected = false;
let lastPgError: string | undefined;

if (process.env.DATABASE_URL) {
  try {
    const dbUrl = process.env.DATABASE_URL;
    const isLocalhost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');

    let dbHostname = '';
    try {
      const parsedUrl = new URL(dbUrl);
      dbHostname = parsedUrl.hostname;
    } catch {}

    // Render internal hostnames (e.g. dpg-xxxx-a) only resolve inside Render's private network.
    // If running in development/preview outside Render, gracefully use persistent local storage.
    const isRenderInternalHost =
      !process.env.RENDER &&
      (!dbHostname.includes('.') || dbHostname.endsWith('.internal') || dbHostname.startsWith('dpg-'));

    if (isRenderInternalHost) {
      console.log(`[Database] Render internal host (${dbHostname}) is private to Render. Using local persistent storage in development/preview.`);
      lastPgError = `Render internal host (${dbHostname}) is private to Render. Local storage active in preview.`;
      isPgConnected = false;
    } else {
      pgPool = new Pool({
        connectionString: dbUrl,
        max: 10,
        connectionTimeoutMillis: 30000, // 30s timeout to allow cloud databases to cold-start
        idleTimeoutMillis: 30000,
        ssl: isLocalhost ? false : { rejectUnauthorized: false },
      });
      drizzleDb = drizzle(pgPool, { schema });

      // Connect with automatic retries for cloud cold starts
      const connectWithRetry = async (retries = 6, delayMs = 3000): Promise<void> => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            console.log(`[Database] Attempting PostgreSQL connection (attempt ${attempt}/${retries})...`);
            await pgPool!.query('SELECT 1');
            console.log('[Database] PostgreSQL connection verified');

            try {
              const { migrate } = await import('drizzle-orm/node-postgres/migrator');
              const migrationsDir = path.resolve(process.cwd(), 'drizzle');
              if (!fs.existsSync(migrationsDir)) {
                throw new Error('Drizzle migrations directory is missing');
              }
              await migrate(drizzleDb!, { migrationsFolder: migrationsDir });
              // Backward-compatible additive settings migration for existing deployments.
              await pgPool!.query("ALTER TABLE sites ADD COLUMN IF NOT EXISTS challenge_model text NOT NULL DEFAULT 'AUTO'");
              await pgPool!.query(`ALTER TABLE sites ADD COLUMN IF NOT EXISTS captcha_settings jsonb NOT NULL DEFAULT '{"textLength":5,"noise":36,"rotation":22,"expiresInSeconds":20,"maxAttempts":4}'::jsonb`);
              isPgConnected = true;
              lastPgError = undefined;
              console.log('[Database] Drizzle migrations applied; PostgreSQL is ready');
              return;
            } catch (migErr: any) {
              lastPgError = migErr?.message || 'Migration failed';
              console.error('[Database] PostgreSQL migration failed:', lastPgError);
              return;
            }
          } catch (err: any) {
            lastPgError = err.message;
            const isDnsFailure =
              err.code === 'EAI_AGAIN' ||
              err.code === 'ENOTFOUND' ||
              err.message?.includes('getaddrinfo');

            if (isDnsFailure && !process.env.RENDER) {
              console.log(`[Database] Hostname resolution unavailable outside Render (${err.message}). Using local storage.`);
              return;
            }

            if (attempt < retries) {
              console.log(`[Database] Retrying connection in ${delayMs / 1000}s...`);
              await new Promise(r => setTimeout(r, delayMs));
            } else {
              console.log('[Database] PostgreSQL connection attempts completed; will retry if re-invoked.');
            }
          }
        }
      };

      connectWithRetry();
    }
  } catch (err: any) {
    lastPgError = err?.message;
  }
}

export function getDatabaseStatus(): DBStatus {
  return {
    isPostgresConnected: isPgConnected,
    engine: isPgConnected ? 'postgresql' : (IS_PRODUCTION ? 'postgresql' : 'file_persisted_storage'),
    databaseUrlConfigured: !!process.env.DATABASE_URL,
    connectionError: lastPgError,
  };
}

export const dbRepository = {
  // USER METHODS
  async getUserByFirebaseUid(firebaseUid: string): Promise<schema.User | null> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.select().from(schema.users).where(eq(schema.users.firebaseUid, firebaseUid)).limit(1);
      return rows[0] || null;
    }
    const state = loadState();
    return state.users.find(u => u.firebaseUid === firebaseUid) || null;
  },

  async getUserById(id: string): Promise<schema.User | null> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
      return rows[0] || null;
    }
    const state = loadState();
    return state.users.find(u => u.id === id) || null;
  },

  async getUserByEmail(email: string): Promise<schema.User | null> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase())).limit(1);
      return rows[0] || null;
    }
    const state = loadState();
    return state.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
  },

  async createUser(data: { firebaseUid: string; email: string; name?: string; role?: string }): Promise<schema.User> {
    const newUser: schema.User = {
      id: `usr_${crypto.randomBytes(8).toString('hex')}`,
      firebaseUid: data.firebaseUid,
      email: data.email.toLowerCase(),
      name: data.name || '',
      role: data.role || 'USER',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.insert(schema.users).values(newUser).returning();
      return rows[0];
    }

    const state = loadState();
    state.users.push(newUser);
    saveState(state);
    return newUser;
  },

  // SITE METHODS
  async getSitesByUserId(userId: string): Promise<schema.Site[]> {
    if (isPgConnected && drizzleDb) {
      return drizzleDb.select().from(schema.sites).where(eq(schema.sites.userId, userId)).orderBy(desc(schema.sites.createdAt));
    }
    const state = loadState();
    return state.sites
      .filter(s => s.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async getSiteByKey(siteKey: string): Promise<schema.Site | null> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.select().from(schema.sites).where(eq(schema.sites.siteKey, siteKey)).limit(1);
      return rows[0] || null;
    }
    const state = loadState();
    return state.sites.find(s => s.siteKey === siteKey) || null;
  },

  async getSiteById(id: string): Promise<schema.Site | null> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.select().from(schema.sites).where(eq(schema.sites.id, id)).limit(1);
      return rows[0] || null;
    }
    const state = loadState();
    return state.sites.find(s => s.id === id) || null;
  },

  async createSite(data: {
    userId: string;
    name: string;
    siteKey: string;
    domains: string[];
    secretKeyHash: string;
    secretKeyPrefix: string;
    maskedSecretKey: string;
    challengeDifficulty?: 'LOW' | 'MEDIUM' | 'HIGH';
    challengeModel?: 'AUTO' | 'IMAGE_SELECTION' | 'ODD_ONE_OUT' | 'ROTATION_MATCH' | 'TEXT' | 'MATH' | 'SHAPES';
    captchaSettings?: { textLength: number; noise: number; rotation: number; expiresInSeconds: number; maxAttempts: number };
    invisibleEnabled?: boolean;
    rateLimitPerMinute?: number;
  }): Promise<schema.Site> {
    const newSite: schema.Site = {
      id: `site_${crypto.randomBytes(8).toString('hex')}`,
      userId: data.userId,
      name: data.name,
      siteKey: data.siteKey,
      domains: data.domains,
      secretKeyHash: data.secretKeyHash,
      secretKeyPrefix: data.secretKeyPrefix,
      maskedSecretKey: data.maskedSecretKey,
      challengeDifficulty: data.challengeDifficulty || 'MEDIUM',
      challengeModel: data.challengeModel || 'AUTO',
      captchaSettings: data.captchaSettings || { textLength: 5, noise: 36, rotation: 22, expiresInSeconds: 20, maxAttempts: 4 },
      invisibleEnabled: data.invisibleEnabled ?? true,
      rateLimitPerMinute: data.rateLimitPerMinute || 600,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.insert(schema.sites).values(newSite).returning();
      return rows[0];
    }

    const state = loadState();
    state.sites.push(newSite);
    saveState(state);
    return newSite;
  },

  async deleteSite(id: string, userId: string): Promise<boolean> {
    if (isPgConnected && drizzleDb) {
      return drizzleDb.transaction(async tx => {
        const ownedSites = await tx.select().from(schema.sites).where(
          and(eq(schema.sites.id, id), eq(schema.sites.userId, userId))
        ).limit(1);
        const deletedSite = ownedSites[0];
        if (!deletedSite) return false;

        // Verification events intentionally have no FK to sites; delete them explicitly
        // so deleting a site also deletes its associated analytics and audit trail.
        await tx.delete(schema.verificationEvents).where(eq(schema.verificationEvents.siteKey, deletedSite.siteKey));
        const removed = await tx.delete(schema.sites).where(
          and(eq(schema.sites.id, id), eq(schema.sites.userId, userId))
        ).returning({ id: schema.sites.id });
        return removed.length > 0;
      });
    }

    const state = loadState();
    const siteIdx = state.sites.findIndex(s => s.id === id && s.userId === userId);
    if (siteIdx === -1) return false;

    const deletedSite = state.sites[siteIdx];
    state.sites.splice(siteIdx, 1);
    // Mirror PostgreSQL cascade behavior in local development storage.
    state.captchaChallenges = state.captchaChallenges.filter(c => c.siteKey !== deletedSite.siteKey);
    state.verificationEvents = state.verificationEvents.filter(event => event.siteKey !== deletedSite.siteKey);
    state.apiKeys = state.apiKeys.filter(key => key.siteId !== deletedSite.id);
    state.usageRecords = state.usageRecords.filter(record => record.siteId !== deletedSite.id);
    saveState(state);
    return true;
  },

  // CAPTCHA CHALLENGE METHODS
  async createChallenge(data: {
    id?: string;
    siteKey: string;
    challengeType: string;
    prompt: string;
    correctAnswerHash: string;
    options: Array<{ id: string; label: string; icon: string }>;
    token: string;
    expiresAt: Date;
    maxAttempts?: number;
  }): Promise<schema.CaptchaChallenge> {
    const challenge: schema.CaptchaChallenge = {
      id: data.id || `ch_${crypto.randomBytes(12).toString('hex')}`,
      siteKey: data.siteKey,
      challengeType: data.challengeType,
      prompt: data.prompt,
      correctAnswerHash: data.correctAnswerHash,
      options: data.options,
      token: data.token,
      expiresAt: data.expiresAt,
      attemptsCount: 0,
      maxAttempts: data.maxAttempts || 4,
      isConsumed: false,
      solvedAt: null,
      serverVerifiedAt: null,
      createdAt: new Date(),
    };

    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.insert(schema.captchaChallenges).values(challenge).returning();
      return rows[0];
    }

    const state = loadState();
    state.captchaChallenges.push(challenge as any);
    saveState(state);
    return challenge;
  },

  async updateChallengeExpiresAt(token: string, expiresAt: Date): Promise<boolean> {
    if (isPgConnected && drizzleDb) {
      await drizzleDb.update(schema.captchaChallenges)
        .set({ expiresAt })
        .where(eq(schema.captchaChallenges.token, token));
      return true;
    }
    const state = loadState();
    const c = state.captchaChallenges.find(x => x.token === token);
    if (!c) return false;
    c.expiresAt = expiresAt;
    saveState(state);
    return true;
  },

  async getChallengeByToken(token: string): Promise<schema.CaptchaChallenge | null> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.select().from(schema.captchaChallenges).where(eq(schema.captchaChallenges.token, token)).limit(1);
      return rows[0] || null;
    }
    const state = loadState();
    const found = state.captchaChallenges.find(c => c.token === token);
    return (found as schema.CaptchaChallenge) || null;
  },

  async getChallengeById(id: string): Promise<schema.CaptchaChallenge | null> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.select().from(schema.captchaChallenges).where(eq(schema.captchaChallenges.id, id)).limit(1);
      return rows[0] || null;
    }
    const state = loadState();
    const found = state.captchaChallenges.find(c => c.id === id);
    return (found as schema.CaptchaChallenge) || null;
  },

  async incrementChallengeAttempts(id: string): Promise<number> {
    if (isPgConnected && drizzleDb) {
      // Increment in one conditional SQL statement so concurrent requests cannot
      // lose increments or push the counter past maxAttempts.
      const rows = await drizzleDb.update(schema.captchaChallenges)
        .set({ attemptsCount: sql`${schema.captchaChallenges.attemptsCount} + 1` })
        .where(and(
          eq(schema.captchaChallenges.id, id),
          eq(schema.captchaChallenges.isConsumed, false),
          sql`${schema.captchaChallenges.attemptsCount} < ${schema.captchaChallenges.maxAttempts}`
        ))
        .returning({ attemptsCount: schema.captchaChallenges.attemptsCount });
      if (rows[0]) return rows[0].attemptsCount;
      const challenge = await this.getChallengeById(id);
      return challenge?.attemptsCount || 0;
    }

    const state = loadState();
    const c = state.captchaChallenges.find(x => x.id === id);
    if (!c) return 0;
    if (c.isConsumed || c.attemptsCount >= c.maxAttempts) return c.attemptsCount;
    c.attemptsCount = (c.attemptsCount || 0) + 1;
    saveState(state);
    return c.attemptsCount;
  },

  // Atomic consumption of challenge to prevent replay attacks
  async consumeChallengeToken(token: string, solved = false): Promise<boolean> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.update(schema.captchaChallenges)
        .set({ isConsumed: true, solvedAt: solved ? new Date() : null })
        .where(and(eq(schema.captchaChallenges.token, token), eq(schema.captchaChallenges.isConsumed, false)))
        .returning();
      return rows.length > 0;
    }

    const state = loadState();
    const c = state.captchaChallenges.find(x => x.token === token);
    if (!c || c.isConsumed) {
      return false; // Already consumed or does not exist
    }
    c.isConsumed = true;
    c.solvedAt = solved ? new Date() : null;
    saveState(state);
    return true;
  },

  // Atomically mark a solved CAPTCHA receipt as verified by the customer backend.
  // Receipts are accepted once and only within two minutes of a successful solve.
  async markChallengeServerVerified(token: string): Promise<boolean> {
    if (isPgConnected && pgPool) {
      const result = await pgPool.query(
        `UPDATE captcha_challenges
         SET server_verified_at = NOW()
         WHERE token = $1
           AND is_consumed = TRUE
           AND solved_at IS NOT NULL
           AND server_verified_at IS NULL
           AND solved_at >= NOW() - INTERVAL '2 minutes'
           AND solved_at <= NOW()
         RETURNING token`,
        [token]
      );
      return result.rowCount === 1;
    }

    const state = loadState();
    const challenge = state.captchaChallenges.find(item => item.token === token);
    if (!challenge || !challenge.isConsumed || !challenge.solvedAt || challenge.serverVerifiedAt) return false;
    const solvedAt = new Date(challenge.solvedAt).getTime();
    const now = Date.now();
    if (!Number.isFinite(solvedAt) || solvedAt > now || now - solvedAt > 2 * 60 * 1000) return false;
    challenge.serverVerifiedAt = new Date();
    saveState(state);
    return true;
  },

  // VERIFICATION EVENTS
  async recordVerificationEvent(data: {
    siteKey: string;
    token: string;
    success: boolean;
    score: number;
    hostname: string;
    action?: string;
    clientIp?: string;
    errorCodes?: string[];
  }): Promise<schema.VerificationEvent> {
    const event: schema.VerificationEvent = {
      id: `ve_${crypto.randomBytes(8).toString('hex')}`,
      siteKey: data.siteKey,
      token: data.token,
      success: data.success,
      score: data.score,
      hostname: data.hostname,
      action: data.action || 'verify',
      clientIp: data.clientIp || '',
      errorCodes: data.errorCodes || [],
      consumedAt: new Date(),
      createdAt: new Date(),
    };

    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.insert(schema.verificationEvents).values(event).returning();
      return rows[0];
    }

    const state = loadState();
    state.verificationEvents.unshift(event as any);
    // Keep max 200 events in memory/disk
    if (state.verificationEvents.length > 200) {
      state.verificationEvents.pop();
    }
    saveState(state);
    return event;
  },

  async getAnalyticsSummary(siteKeys: string[], since: Date): Promise<{ totalRequests: number; passedRequests: number; blockedRequests: number; recentEvents: schema.VerificationEvent[]; hourlyTraffic: Array<{ hour: string; passed: number; blocked: number }> }> {
    if (siteKeys.length === 0) {
      return { totalRequests: 0, passedRequests: 0, blockedRequests: 0, recentEvents: [], hourlyTraffic: [] };
    }

    if (isPgConnected && drizzleDb && pgPool) {
      const counts = await pgPool.query(
        'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE success = TRUE)::int AS passed FROM verification_events WHERE site_key = ANY($1::text[]) AND created_at >= $2',
        [siteKeys, since]
      );
      const recentEvents = await drizzleDb.select().from(schema.verificationEvents)
        .where(and(inArray(schema.verificationEvents.siteKey, siteKeys), gte(schema.verificationEvents.createdAt, since)))
        .orderBy(desc(schema.verificationEvents.createdAt))
        .limit(50);
      const hourlyRows = await pgPool.query(
        'SELECT date_trunc(\'hour\', created_at AT TIME ZONE \'UTC\') AT TIME ZONE \'UTC\' AS hour, COUNT(*) FILTER (WHERE success = TRUE)::int AS passed, COUNT(*) FILTER (WHERE success = FALSE)::int AS blocked FROM verification_events WHERE site_key = ANY($1::text[]) AND created_at >= $2 GROUP BY 1 ORDER BY 1',
        [siteKeys, since]
      );
      const hourlyTraffic = hourlyRows.rows.map((row: { hour: Date | string; passed: number | string; blocked: number | string }) => ({
        hour: new Date(row.hour).toISOString(),
        passed: Number(row.passed || 0),
        blocked: Number(row.blocked || 0),
      }));
      const totalRequests = Number(counts.rows[0]?.total || 0);
      const passedRequests = Number(counts.rows[0]?.passed || 0);
      return { totalRequests, passedRequests, blockedRequests: totalRequests - passedRequests, recentEvents, hourlyTraffic };
    }

    const state = loadState();
    const events = state.verificationEvents
      .filter(e => siteKeys.includes(e.siteKey) && new Date(e.createdAt).getTime() >= since.getTime())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const totalRequests = events.length;
    const passedRequests = events.filter(e => e.success).length;
    const hourlyMap = new Map<string, { hour: string; passed: number; blocked: number }>();
    for (const event of events) {
      const bucket = new Date(event.createdAt);
      bucket.setUTCMinutes(0, 0, 0);
      const hour = bucket.toISOString();
      const current = hourlyMap.get(hour) || { hour, passed: 0, blocked: 0 };
      if (event.success) current.passed++;
      else current.blocked++;
      hourlyMap.set(hour, current);
    }
    return {
      totalRequests,
      passedRequests,
      blockedRequests: totalRequests - passedRequests,
      recentEvents: events.slice(0, 50) as schema.VerificationEvent[],
      hourlyTraffic: [...hourlyMap.values()].sort((a, b) => a.hour.localeCompare(b.hour)),
    };
  },

  async getRecentEvents(siteKey?: string): Promise<schema.VerificationEvent[]> {
    if (isPgConnected && drizzleDb) {
      if (siteKey) {
        return drizzleDb.select().from(schema.verificationEvents)
          .where(eq(schema.verificationEvents.siteKey, siteKey))
          .orderBy(desc(schema.verificationEvents.createdAt))
          .limit(50);
      }
      return drizzleDb.select().from(schema.verificationEvents)
        .orderBy(desc(schema.verificationEvents.createdAt))
        .limit(50);
    }

    const state = loadState();
    if (siteKey) {
      return (state.verificationEvents.filter(e => e.siteKey === siteKey).slice(0, 50) as schema.VerificationEvent[]);
    }
    return (state.verificationEvents.slice(0, 50) as schema.VerificationEvent[]);
  },
};
