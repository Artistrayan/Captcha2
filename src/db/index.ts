import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.ts';
import { eq, and, desc } from 'drizzle-orm';

const { Pool } = pg;

export interface DBStatus {
  isPostgresConnected: boolean;
  engine: 'postgresql' | 'file_persisted_storage';
  databaseUrlConfigured: boolean;
  connectionError?: string;
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

    pgPool = new Pool({
      connectionString: dbUrl,
      max: 10,
      connectionTimeoutMillis: 5000,
      ssl: isLocalhost ? false : { rejectUnauthorized: false },
    });
    drizzleDb = drizzle(pgPool, { schema });

    // Test connection asynchronously
    pgPool.query('SELECT 1')
      .then(async () => {
        isPgConnected = true;
        console.log('[Database] Connected to PostgreSQL via Drizzle ORM');

        // Automatically apply migrations to PostgreSQL if available
        try {
          const { migrate } = await import('drizzle-orm/node-postgres/migrator');
          const migrationsDir = path.resolve(process.cwd(), 'drizzle');
          if (fs.existsSync(migrationsDir)) {
            await migrate(drizzleDb!, { migrationsFolder: migrationsDir });
            console.log('[Database] Drizzle migrations applied successfully to PostgreSQL');
          }
        } catch (migErr: any) {
          console.warn('[Database] Drizzle migration check note:', migErr.message);
        }
      })
      .catch((err) => {
        isPgConnected = false;
        lastPgError = err.message;
        console.warn('[Database] PostgreSQL connection failed, operating with persistent file repository fallback:', err.message);
      });
  } catch (err: any) {
    lastPgError = err?.message;
  }
}

export function getDatabaseStatus(): DBStatus {
  return {
    isPostgresConnected: isPgConnected,
    engine: isPgConnected ? 'postgresql' : 'file_persisted_storage',
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
      const res = await drizzleDb.delete(schema.sites).where(
        and(eq(schema.sites.id, id), eq(schema.sites.userId, userId))
      ).returning();
      return res.length > 0;
    }

    const state = loadState();
    const siteIdx = state.sites.findIndex(s => s.id === id && s.userId === userId);
    if (siteIdx === -1) return false;

    state.sites.splice(siteIdx, 1);
    // Cascade delete challenges
    state.captchaChallenges = state.captchaChallenges.filter(c => c.siteKey !== state.sites[siteIdx]?.siteKey);
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
      maxAttempts: data.maxAttempts || 3,
      isConsumed: false,
      solvedAt: null,
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
      const challenge = await this.getChallengeById(id);
      if (!challenge) return 0;
      const newCount = challenge.attemptsCount + 1;
      await drizzleDb.update(schema.captchaChallenges)
        .set({ attemptsCount: newCount })
        .where(eq(schema.captchaChallenges.id, id));
      return newCount;
    }

    const state = loadState();
    const c = state.captchaChallenges.find(x => x.id === id);
    if (!c) return 0;
    c.attemptsCount = (c.attemptsCount || 0) + 1;
    saveState(state);
    return c.attemptsCount;
  },

  // Atomic consumption of challenge to prevent replay attacks
  async consumeChallengeToken(token: string): Promise<boolean> {
    if (isPgConnected && drizzleDb) {
      const rows = await drizzleDb.update(schema.captchaChallenges)
        .set({ isConsumed: true, solvedAt: new Date() })
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
    c.solvedAt = new Date();
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
