-- Support efficient full accounting exports and expiry sweeps as invoice volume grows.
CREATE INDEX IF NOT EXISTS billing_invoices_created_at_idx
  ON billing_invoices (created_at DESC);

CREATE INDEX IF NOT EXISTS billing_invoices_pending_expiry_idx
  ON billing_invoices (expires_at)
  WHERE status = 'pending';
