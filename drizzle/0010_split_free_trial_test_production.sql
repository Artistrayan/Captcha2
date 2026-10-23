ALTER TABLE captcha_free_trial_usage
  ADD COLUMN IF NOT EXISTS test_used_count integer NOT NULL DEFAULT 0
    CHECK (test_used_count >= 0 AND test_used_count <= 10),
  ADD COLUMN IF NOT EXISTS production_used_count integer NOT NULL DEFAULT 0
    CHECK (production_used_count >= 0 AND production_used_count <= 10);

-- Preserve the legacy aggregate count. Attribute existing free usage to production,
-- without granting accounts a fresh 20 challenges after this quota split.
UPDATE captcha_free_trial_usage
SET production_used_count = LEAST(used_count, 10),
    test_used_count = 0
WHERE test_used_count = 0
  AND production_used_count = 0
  AND used_count > 0;
