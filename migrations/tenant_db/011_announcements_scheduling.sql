ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS is_important BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE notices
  DROP CONSTRAINT IF EXISTS notices_schedule_check;
ALTER TABLE notices
  ADD CONSTRAINT notices_schedule_check
  CHECK (ends_at IS NULL OR ends_at > starts_at);

CREATE INDEX IF NOT EXISTS notices_published_schedule_idx
  ON notices (tenant_id, starts_at, ends_at, published_at DESC)
  WHERE status = 'published';
