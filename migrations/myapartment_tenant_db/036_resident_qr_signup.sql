SET search_path TO block9_tenant, public;

ALTER TABLE resident_invitations
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'email' CHECK (kind IN ('email', 'qr')),
  ALTER COLUMN full_name DROP NOT NULL,
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN occupancy_type DROP NOT NULL;

ALTER TABLE resident_invitations ADD CONSTRAINT resident_invitation_details_check
  CHECK ((kind = 'qr' AND status <> 'accepted') OR
    (full_name IS NOT NULL AND email IS NOT NULL AND occupancy_type IS NOT NULL));

CREATE TABLE resident_access_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  invitation_id UUID REFERENCES resident_invitations(id),
  unit_id UUID REFERENCES units(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX resident_access_audit_tenant_idx ON resident_access_audit(tenant_id, created_at DESC);
