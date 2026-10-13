ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS database_name TEXT;

ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS plan_name TEXT NOT NULL DEFAULT 'standard';

UPDATE tenant_records
SET database_name = database_locator
WHERE database_name IS NULL
  AND database_locator ~ '^[a-z][a-z0-9_]{0,62}$';

CREATE TABLE IF NOT EXISTS tenant_memberships (
  subject TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenant_records (tenant_id),
  role TEXT NOT NULL CHECK (role IN ('resident', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject, tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_memberships_subject_status_idx
  ON tenant_memberships (subject, status);

CREATE TABLE IF NOT EXISTS platform_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
