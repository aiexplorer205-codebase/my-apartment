ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS admin_invite_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS admin_invite_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_invite_accepted_at TIMESTAMPTZ;
