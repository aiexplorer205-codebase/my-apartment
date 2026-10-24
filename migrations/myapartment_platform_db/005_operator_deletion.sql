SET search_path TO block9_platform, public;
ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS admin_auth0_user_id TEXT,
  ADD COLUMN IF NOT EXISTS admin_auth0_user_created BOOLEAN NOT NULL DEFAULT FALSE;
