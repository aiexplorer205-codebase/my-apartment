ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS allowed_blocks INTEGER NOT NULL DEFAULT 1
    CHECK (allowed_blocks BETWEEN 1 AND 500);

ALTER TABLE tenant_records DROP COLUMN IF EXISTS estimated_units;
