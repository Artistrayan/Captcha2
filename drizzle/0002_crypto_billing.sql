CREATE TABLE IF NOT EXISTS billing_invoices (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL CHECK (plan_id IN ('starter','pro','business')),
  amount_usdt numeric(18,2) NOT NULL CHECK (amount_usdt > 0),
  payment_address text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','verifying')),
  txid text UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS billing_invoices_user_created_idx ON billing_invoices(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL CHECK (plan_id IN ('starter','pro','business')),
  request_limit integer NOT NULL,
  status text NOT NULL CHECK (status IN ('active','expired','cancelled')),
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  invoice_id text NOT NULL UNIQUE REFERENCES billing_invoices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS billing_subscriptions_user_status_idx ON billing_subscriptions(user_id, status, expires_at DESC);
