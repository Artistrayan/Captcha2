ALTER TABLE verification_events
  ADD COLUMN IF NOT EXISTS user_agent text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS accept_language_present boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS elapsed_ms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempts_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS same_ip_recent_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS same_ip_recent_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ml_label text;

ALTER TABLE verification_events
  ADD CONSTRAINT verification_events_ml_label_check
  CHECK (ml_label IS NULL OR ml_label IN ('human', 'bot'));
