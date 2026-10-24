SET search_path TO block9_tenant, public;
ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS is_banner BOOLEAN NOT NULL DEFAULT FALSE;
