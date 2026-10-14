ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS occupancy_type TEXT NOT NULL DEFAULT 'owner'
    CHECK (occupancy_type IN ('owner', 'tenant'));

CREATE TABLE IF NOT EXISTS resident_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  unit_id UUID NOT NULL REFERENCES units (id),
  full_name TEXT NOT NULL,
  email CITEXT NOT NULL,
  phone TEXT,
  occupancy_type TEXT NOT NULL CHECK (occupancy_type IN ('owner', 'tenant')),
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS resident_invitations_one_pending_email_idx
  ON resident_invitations (tenant_id, lower(email::text))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS resident_invitations_tenant_status_idx
  ON resident_invitations (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS residents_tenant_email_idx
  ON residents (email);
