-- Shared fixed-window rate limits survive application restarts and multiple Render instances.
CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  bucket_hash text NOT NULL,
  window_start_ms bigint NOT NULL,
  hit_count integer NOT NULL CHECK (hit_count >= 1),
  PRIMARY KEY (bucket_hash, window_start_ms)
);
CREATE INDEX IF NOT EXISTS api_rate_limit_buckets_window_idx
  ON api_rate_limit_buckets(window_start_ms);
