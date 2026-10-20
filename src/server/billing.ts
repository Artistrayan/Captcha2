import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import { verifyTokenServerSide, getOrCreateUser } from '../auth/firebase.ts';

const { Pool } = pg;
export const billingRouter = Router();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
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
export async function checkCaptchaQuota(siteKey: string, reserveRequests = 1): Promise<{ allowed: boolean; used: number; limit: number; plan: string }> {
  // Local file-storage development has no billing database; keep its existing test flow.
  if (!process.env.DATABASE_URL) return { allowed: true, used: 0, limit: 10000, plan: 'free' };
  const db = getPool();
  const owner = await db.query(
    `SELECT s.user_id, COALESCE((
       SELECT bs.request_limit FROM billing_subscriptions bs
       WHERE bs.user_id = s.user_id AND bs.status = 'active' AND bs.expires_at > NOW()
       ORDER BY bs.request_limit DESC LIMIT 1
     ), 10000)::int AS quota
     FROM sites s WHERE s.site_key = $1 LIMIT 1`,
    [siteKey],
  );
  if (!owner.rows[0]) return { allowed: true, used: 0, limit: 10000, plan: 'free' };
  const userId = owner.rows[0].user_id;
  const quota = Number(owner.rows[0].quota) || 10000;
  const usage = await db.query(
    `SELECT (
       (SELECT COUNT(*) FROM captcha_challenges c JOIN sites s ON s.site_key = c.site_key
        WHERE s.user_id = $1 AND c.created_at >= NOW() - INTERVAL '30 days') +
       (SELECT COUNT(*) FROM verification_events v JOIN sites s ON s.site_key = v.site_key
        WHERE s.user_id = $1 AND v.created_at >= NOW() - INTERVAL '30 days')
     )::int AS used`,
    [userId],
  );
  const used = Number(usage.rows[0]?.used || 0);
  return { allowed: used + reserveRequests <= quota, used, limit: quota, plan: quota === 10000 ? 'free' : 'paid' };
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
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, name: p.name, priceUsd: p.baseCents / 100, requests: p.requests })),
    message: configReady() ? undefined : 'Payments are not enabled until USDT_TRC20_RECEIVE_ADDRESS and TRON_PRO_API_KEY are configured in the server environment.',
  });
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
    const reused = await client.query('SELECT id FROM billing_invoices WHERE txid=$1 AND status IN (\'paid\',\'verifying\')', [txid]);
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
