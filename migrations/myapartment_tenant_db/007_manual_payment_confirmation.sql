SET search_path TO block9_tenant, public;
ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_status_check
    CHECK (status IN ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'reconciled', 'confirmed')),
  ADD COLUMN IF NOT EXISTS confirmed_by TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_confirmation_metadata_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_confirmation_metadata_check
    CHECK (status <> 'confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS payments_pending_confirmation_idx
  ON payments (created_at DESC)
  WHERE method = 'offline_manual' AND status = 'pending';
