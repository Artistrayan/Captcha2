import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { verifyTokenServerSide, getOrCreateUser } from '../auth/firebase.ts';

const { Pool } = pg;
export const billingRouter = Router();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const BONUS_REQUESTS_BY_PLAN = { starter: 50, pro: 500, business: 2500 } as const;
export const FREE_TRIAL_CAPTCHA_LIMIT = 20;

export function quotaAllows(used: number, limit: number, requested = 1): boolean {
  return Number.isSafeInteger(used) && Number.isSafeInteger(limit) && Number.isSafeInteger(requested) && used >= 0 && limit >= 0 && requested > 0 && used + requested <= limit;
}
const PLANS = {
  starter: { name: 'Starter', baseCents: 900, requests: 100000 },
  pro: { name: 'Pro', baseCents: 4900, requests: 1000000 },
  business: { name: 'Business', baseCents: 19900, requests: 5000000 },
} as const;
type PlanId = keyof typeof PLANS;
let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }, max: 5 });
  return pool;
}
export async function checkSiteRegistrationQuota(userId: string): Promise<{ allowed: boolean; used: number; limit: number; plan: string }> {
  // Development without PostgreSQL keeps the local test workflow available.
  if (!process.env.DATABASE_URL) return { allowed: true, used: 0, limit: 1, plan: 'free' };
  const db = getPool();
  const subscription = await db.query(
    `SELECT plan_id, request_limit FROM billing_subscriptions
     WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
     ORDER BY request_limit DESC LIMIT 1`,
    [userId],
  );
  const isPaid = subscription.rows.length > 0;
  const limit = isPaid ? 10 : 1;
  const count = await db.query('SELECT COUNT(*)::int AS used FROM sites WHERE user_id = $1', [userId]);
  const used = Number(count.rows[0]?.used || 0);
  return { allowed: used < limit, used, limit, plan: isPaid ? String(subscription.rows[0].plan_id) : 'free' };
}

let freeTrialTableReady: Promise<void> | null = null;
let billingUsageTableReady: Promise<void> | null = null;

async function ensureFreeTrialTable(): Promise<void> {
  if (!freeTrialTableReady) {
    freeTrialTableReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS captcha_free_trial_usage (
        user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= 20),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined).catch((error) => {
      freeTrialTableReady = null;
      throw error;
    });
  }
  await freeTrialTableReady;
}

async function ensureBillingUsageTable(): Promise<void> {
  if (!billingUsageTableReady) {
    billingUsageTableReady = (async () => {
      const db = getPool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS captcha_billing_usage (
          reservation_id text PRIMARY KEY,
          user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          challenge_token text UNIQUE,
          created_at timestamptz NOT NULL DEFAULT NOW()
        )
      `);
      await db.query('CREATE INDEX IF NOT EXISTS captcha_billing_usage_user_created_idx ON captcha_billing_usage(user_id, created_at DESC)');
    })().catch((error) => {
      billingUsageTableReady = null;
      throw error;
    });
  }
  await billingUsageTableReady;
}

export async function reservePaidCaptchaUsage(siteKey: string): Promise<{
  isPaid: boolean; allowed: boolean; used: number; limit: number; userId?: string; reservationId?: string;
}> {
  if (!process.env.DATABASE_URL) return { isPaid: false, allowed: true, used: 0, limit: 10000 };
  const account = await getCaptchaAccount(siteKey);
  if (!account) return { isPaid: false, allowed: true, used: 0, limit: 10000 };
  if (account.paidQuota <= 0) return { isPaid: false, allowed: true, used: 0, limit: FREE_TRIAL_CAPTCHA_LIMIT, userId: account.userId };

  await ensureBillingUsageTable();
  const client = await getPool().connect();
  const reservationId = `usage_${crypto.randomBytes(16).toString('hex')}`;
  try {
    await client.query('BEGIN');
    // Serialize quota reservations per account so parallel sites cannot exceed the shared allowance.
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [account.userId]);
    const usage = await client.query(
      `SELECT COUNT(*)::int AS used FROM captcha_billing_usage
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
      [account.userId],
    );
    const used = Number(usage.rows[0]?.used || 0);
    if (!quotaAllows(used, account.paidQuota, 1)) {
      await client.query('ROLLBACK');
      return { isPaid: true, allowed: false, used, limit: account.paidQuota, userId: account.userId };
    }
    await client.query(
      'INSERT INTO captcha_billing_usage (reservation_id, user_id) VALUES ($1, $2)',
      [reservationId, account.userId],
    );
    await client.query('COMMIT');
    return { isPaid: true, allowed: true, used: used + 1, limit: account.paidQuota, userId: account.userId, reservationId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function completePaidCaptchaUsage(reservationId: string, challengeToken: string): Promise<void> {
  if (!process.env.DATABASE_URL || !reservationId) return;
  await ensureBillingUsageTable();
  await getPool().query(
    'UPDATE captcha_billing_usage SET challenge_token = $2 WHERE reservation_id = $1',
    [reservationId, challengeToken],
  );
}

export async function releasePaidCaptchaUsage(reservationId: string): Promise<void> {
  if (!process.env.DATABASE_URL || !reservationId) return;
  await ensureBillingUsageTable();
  await getPool().query('DELETE FROM captcha_billing_usage WHERE reservation_id = $1 AND challenge_token IS NULL', [reservationId]);
}

export async function releaseFreeCaptchaTrial(userId: string): Promise<void> {
  if (!process.env.DATABASE_URL || !userId) return;
  await ensureFreeTrialTable();
  await getPool().query(
    'UPDATE captcha_free_trial_usage SET used_count = GREATEST(used_count - 1, 0), updated_at = NOW() WHERE user_id = $1',
    [userId],
  );
}

export async function checkCaptchaQuota(siteKey: string, reserveRequests = 1): Promise<{ allowed: boolean; used: number; limit: number; plan: string }> {
  if (!process.env.DATABASE_URL) return { allowed: true, used: 0, limit: 10000, plan: 'free' };
  const account = await getCaptchaAccount(siteKey);
  if (!account) return { allowed: false, used: 0, limit: 0, plan: 'invalid-site' };

  if (account.paidQuota <= 0) {
    await ensureFreeTrialTable();
    const result = await getPool().query(
      'SELECT used_count FROM captcha_free_trial_usage WHERE user_id = $1',
      [account.userId],
    );
    const used = Number(result.rows[0]?.used_count || 0);
    return { allowed: quotaAllows(used, FREE_TRIAL_CAPTCHA_LIMIT, reserveRequests), used, limit: FREE_TRIAL_CAPTCHA_LIMIT, plan: 'free-trial' };
  }

  await ensureBillingUsageTable();
  const usage = await getPool().query(
    `SELECT COUNT(*)::int AS used FROM captcha_billing_usage
     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`,
    [account.userId],
  );
  const used = Number(usage.rows[0]?.used || 0);
  return { allowed: quotaAllows(used, account.paidQuota, reserveRequests), used, limit: account.paidQuota, plan: 'paid' };
}

function configReady() {
  const address = process.env.USDT_TRC20_RECEIVE_ADDRESS || '';
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) && Boolean(process.env.TRON_PRO_API_KEY);
}
async function requireBillingAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const decoded = await verifyTokenServerSide(header);
    (req as any).billingUser = await getOrCreateUser(decoded);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized', message: 'Please sign in again.' });
  }
}
billingRouter.use(requireBillingAuth);

const billingRateLimits = new Map<string, { count: number; resetAt: number }>();
billingRouter.use((req, res, next) => {
  const userId = (req as any).billingUser?.id || 'unknown';
  const category = req.path.includes('/verify') ? 'verify' : req.path === '/invoices' ? 'invoices' : req.path;
  const key = `${userId}:${req.method}:${category}`;
  const now = Date.now();
  if (billingRateLimits.size > 3000) {
    for (const [storedKey, value] of billingRateLimits) if (value.resetAt <= now) billingRateLimits.delete(storedKey);
  }
  const entry = billingRateLimits.get(key);
  if (!entry || entry.resetAt <= now) {
    billingRateLimits.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  if (entry.count >= 15) {
    res.status(429).json({ error: 'Billing rate limit exceeded. Please retry in a minute.' });
    return;
  }
  entry.count += 1;
  next();
});
billingRouter.get('/config', (_req, res) => {
  res.json({
    ready: configReady(),
    network: 'TRON (TRC20)',
    currency: 'USDT',
    walletAddress: configReady() ? process.env.USDT_TRC20_RECEIVE_ADDRESS : null,
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, priceUsd: p.baseCents / 100, requests: p.requests, bonusRequests: BONUS_REQUESTS_BY_PLAN[id as PlanId] })),
    message: configReady() ? undefined : 'Payments are not enabled until USDT_TRC20_RECEIVE_ADDRESS and TRON_PRO_API_KEY are configured in the server environment.',
  });
});
// Administrator-only accounting summary. Revenue counts only invoices verified on-chain as paid.
billingRouter.get('/admin/summary', async (req, res) => {
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const userEmail = String((req as any).billingUser?.email || '').trim().toLowerCase();
  if (!adminEmail || userEmail !== adminEmail) {
    res.status(403).json({ error: 'Administrator access required.' });
    return;
  }
  try {
    const db = getPool();
    const [totals, statuses, plans, recent, subscriptions] = await Promise.all([
      db.query(`
        SELECT COUNT(*)::int AS total_invoices,
          COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_invoices,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_invoices,
          COUNT(*) FILTER (WHERE status = 'expired')::int AS expired_invoices,
          COALESCE(SUM(amount_usdt) FILTER (WHERE status = 'paid'), 0)::numeric(14,2) AS revenue_all,
          COALESCE(SUM(amount_usdt) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', NOW())), 0)::numeric(14,2) AS revenue_month,
          COUNT(*) FILTER (WHERE status = 'paid' AND paid_at >= date_trunc('month', NOW()))::int AS paid_this_month,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS invoices_30d
        FROM billing_invoices
      `),
      db.query(`SELECT status, COUNT(*)::int AS count FROM billing_invoices GROUP BY status ORDER BY status`),
      db.query(`SELECT plan_id, COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
          COALESCE(SUM(amount_usdt) FILTER (WHERE status = 'paid'),0)::numeric(14,2) AS revenue
        FROM billing_invoices GROUP BY plan_id ORDER BY plan_id`),
      db.query(`SELECT i.id, i.plan_id, i.amount_usdt, i.status, i.txid, i.created_at, i.paid_at,
          COALESCE(u.email, 'unknown') AS email
        FROM billing_invoices i LEFT JOIN users u ON u.id = i.user_id
        ORDER BY i.created_at DESC LIMIT 100`),
      db.query(`SELECT COUNT(*) FILTER (WHERE status = 'active' AND expires_at > NOW())::int AS active,
          COUNT(*) FILTER (WHERE status <> 'active' OR expires_at <= NOW())::int AS inactive
        FROM billing_subscriptions`)
    ]);
    res.json({
      generatedAt: new Date().toISOString(),
      totals: totals.rows[0],
      statuses: statuses.rows,
      plans: plans.rows,
      recentInvoices: recent.rows,
      subscriptions: subscriptions.rows[0],
      accountingNote: 'Revenue includes only invoices confirmed as paid by on-chain verification; pending, expired, and unmatched payments are excluded.'
    });
  } catch (error: any) {
    console.error('[Billing] Admin accounting summary failed:', error?.message);
    res.status(503).json({ error: 'Accounting data is unavailable. Check database migrations and billing tables.' });
  }
});

billingRouter.get('/invoices', async (req, res) => {
  try {
    const user = (req as any).billingUser;
    const result = await getPool().query(
      'SELECT id, plan_id, amount_usdt, status, txid, expires_at, created_at, paid_at FROM billing_invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
      [user.id],
    );
    res.json({ invoices: result.rows });
  } catch (error: any) {
    console.error('[Billing] invoice list failed:', error?.message);
    res.status(503).json({ error: 'Billing storage unavailable. Check PostgreSQL migration status.' });
  }
});
billingRouter.post('/invoices', async (req, res) => {
  const user = (req as any).billingUser;
  const planId = req.body?.plan as PlanId;
  if (!Object.prototype.hasOwnProperty.call(PLANS, planId)) { res.status(400).json({ error: 'Invalid plan' }); return; }
  if (!configReady()) { res.status(503).json({ error: 'Crypto payments are not configured yet.' }); return; }
  try {
    const plan = PLANS[planId];
    // Keep published plan pricing exact; the submitted transaction ID identifies the invoice.
    const amountCents = plan.baseCents;
    const id = 'inv_' + crypto.randomBytes(12).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const result = await getPool().query(
      `INSERT INTO billing_invoices (id, user_id, plan_id, amount_usdt, payment_address, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6) RETURNING id, plan_id, amount_usdt, payment_address, status, expires_at, created_at`,
      [id, user.id, planId, (amountCents / 100).toFixed(2), process.env.USDT_TRC20_RECEIVE_ADDRESS, expiresAt],
    );
    res.status(201).json({ invoice: result.rows[0], network: 'TRON (TRC20)', currency: 'USDT', tokenContract: TRON_USDT_CONTRACT, instructions: 'Send the exact USDT amount on TRON (TRC20), then submit the transaction ID for on-chain verification. Sending another token or using another network will not activate the plan.' });
  } catch (error: any) {
    console.error('[Billing] invoice creation failed:', error?.message);
    res.status(503).json({ error: 'Could not create invoice. Check PostgreSQL migration status.' });
  }
});
billingRouter.post('/invoices/:id/verify', async (req, res) => {
  const user = (req as any).billingUser;
  const txid = String(req.body?.txid || '').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(txid)) { res.status(400).json({ error: 'Enter a valid 64-character transaction ID.' }); return; }
  if (!configReady()) { res.status(503).json({ error: 'Crypto payments are not configured yet.' }); return; }
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM billing_invoices WHERE id = $1 AND user_id = $2 FOR UPDATE', [req.params.id, user.id]);
    const invoice = found.rows[0];
    if (!invoice) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Invoice not found.' }); return; }
    if (invoice.status === 'paid') { await client.query('COMMIT'); res.json({ status: 'paid', message: 'This invoice is already paid.' }); return; }
    if (new Date(invoice.expires_at).getTime() < Date.now()) {
      await client.query("UPDATE billing_invoices SET status='expired' WHERE id=$1", [invoice.id]);
      await client.query('COMMIT');
      res.status(410).json({ status: 'expired', error: 'Invoice expired. Create a new invoice.' });
      return;
    }
    // Serialize verification attempts for the same transaction across different invoices.
    // The unique txid constraint remains the final database-level idempotency guard.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [txid.toLowerCase()]);
    const reused = await client.query(
      "SELECT id FROM billing_invoices WHERE txid=$1 AND status IN ('paid','verifying')",
      [txid.toLowerCase()],
    );
    if (reused.rows.length) { await client.query('ROLLBACK'); res.status(409).json({ error: 'This transaction has already been used.' }); return; }
    const apiKey = process.env.TRON_PRO_API_KEY!;
    const headers = { 'TRON-PRO-API-KEY': apiKey, 'Content-Type': 'application/json' };
    const [eventsResponse, infoResponse, blockResponse] = await Promise.all([
      fetch(`https://api.trongrid.io/v1/transactions/${txid}/events?only_confirmed=true&limit=200`, { headers }),
      fetch('https://api.trongrid.io/wallet/gettransactioninfobyid', { method: 'POST', headers, body: JSON.stringify({ value: txid }) }),
      fetch('https://api.trongrid.io/wallet/getnowblock', { method: 'POST', headers, body: '{}' }),
    ]);
    if (!eventsResponse.ok || !infoResponse.ok || !blockResponse.ok) throw new Error('TRON provider request failed');
    const [eventsJson, info, block] = await Promise.all([eventsResponse.json(), infoResponse.json(), blockResponse.json()]);
    const txInfo = info as any;
    const currentHeight = Number((block as any)?.block_header?.raw_data?.number);
    const txHeight = Number(txInfo?.blockNumber);
    if (!txInfo?.id || txInfo.id.toLowerCase() !== txid.toLowerCase() || txInfo?.receipt?.result !== 'SUCCESS' || !Number.isFinite(currentHeight) || !Number.isFinite(txHeight) || currentHeight - txHeight < 19) {
      await client.query('ROLLBACK');
      res.status(202).json({ status: 'pending', message: 'Transaction not confirmed yet. Wait for network confirmations and try again.' });
      return;
    }
    const events = Array.isArray((eventsJson as any)?.data) ? (eventsJson as any).data : [];
    const expectedUnits = BigInt(Math.round(Number(invoice.amount_usdt) * 1_000_000));
    const payment = events.find((event: any) =>
      String(event?.transaction_id || '').toLowerCase() === txid.toLowerCase() &&
      String(event?.contract_address || '').toLowerCase() === TRON_USDT_CONTRACT.toLowerCase() &&
      event?.event_name === 'Transfer' &&
      String(event?.result?.to || '').toLowerCase() === String(invoice.payment_address).toLowerCase() &&
      /^\d+$/.test(String(event?.result?.value || '')) &&
      BigInt(String(event.result.value)) === expectedUnits
    );
    if (!payment) {
      await client.query('ROLLBACK');
      res.status(422).json({ status: 'unmatched', error: 'Confirmed transaction does not match the exact invoice amount, destination wallet, and USDT TRC20 contract.' });
      return;
    }
    await client.query(
      "UPDATE billing_invoices SET status='paid', txid=$2, paid_at=NOW() WHERE id=$1",
      [invoice.id, txid.toLowerCase()],
    );
    const plan = PLANS[invoice.plan_id as PlanId];
    await client.query(
      `INSERT INTO billing_subscriptions (user_id, plan_id, request_limit, status, started_at, expires_at, invoice_id)
       VALUES ($1,$2,$3,'active',NOW(),NOW() + INTERVAL '30 days',$4)
       ON CONFLICT (invoice_id) DO NOTHING`,
      [user.id, invoice.plan_id, plan.requests, invoice.id],
    );
    await client.query('COMMIT');
    res.json({ status: 'paid', message: 'Payment confirmed on-chain. Your 30-day plan is active.', plan: invoice.plan_id, requestLimit: plan.requests });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[Billing] verification failed:', error?.message);
    res.status(503).json({ error: 'Could not verify payment right now. No subscription was activated; retry later.' });
  } finally {
    client.release();
  }
});
