-- Account-wide rolling 30-day ledger: one unit per issued paid CAPTCHA.
-- Backfill existing challenges to preserve already-consumed quota after deployment.
CREATE TABLE IF NOT EXISTS captcha_billing_usage (
  reservation_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS captcha_billing_usage_user_created_idx
  ON captcha_billing_usage(user_id, created_at DESC);

INSERT INTO captcha_billing_usage (reservation_id, user_id, challenge_token, created_at)
SELECT c.id, s.user_id, c.token, c.created_at
FROM captcha_challenges c
JOIN sites s ON s.site_key = c.site_key
WHERE c.created_at >= NOW() - INTERVAL '30 days'
ON CONFLICT DO NOTHING;

-- Upgrade the existing free-trial counter without resetting used_count.
CREATE TABLE IF NOT EXISTS captcha_free_trial_usage (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  used_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE captcha_free_trial_usage
  DROP CONSTRAINT IF EXISTS captcha_free_trial_usage_used_count_check;
ALTER TABLE captcha_free_trial_usage
  ADD CONSTRAINT captcha_free_trial_usage_used_count_check
  CHECK (used_count >= 0 AND used_count <= 20);
