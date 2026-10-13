ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS admin_email TEXT,
  ADD COLUMN IF NOT EXISTS estimated_units INTEGER,
  ADD COLUMN IF NOT EXISTS auth0_organization_id TEXT,
  ADD COLUMN IF NOT EXISTS auth0_invitation_id TEXT,
  ADD COLUMN IF NOT EXISTS admin_invited_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_records_auth0_organization_id_idx
  ON tenant_records (auth0_organization_id)
  WHERE auth0_organization_id IS NOT NULL;
