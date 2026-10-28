SET LOCAL search_path = block9_platform;
ALTER TABLE resident_auth_user ADD COLUMN "qrEnrolled" BOOLEAN NOT NULL DEFAULT FALSE;
-- Authentication capabilities, issued only after server-side admin authorization.
-- Store token hashes only; the QR bearer secret is returned once to the administrator.
CREATE TABLE resident_auth_qr (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES tenant_records(tenant_id),
  invitation_id UUID,
  user_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  purpose TEXT NOT NULL CHECK (purpose IN ('invitation', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  issued_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','cancelled','superseded')),
  challenge TEXT,
  challenge_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK ((purpose = 'invitation') = (invitation_id IS NOT NULL))
);
CREATE UNIQUE INDEX resident_auth_qr_pending_user ON resident_auth_qr(user_id) WHERE status='pending';
CREATE INDEX resident_auth_qr_pending_tenant ON resident_auth_qr(tenant_id, status);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_platform') THEN
    GRANT SELECT, INSERT, UPDATE ON resident_auth_qr TO myapartment_platform;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_resident_auth') THEN
    GRANT SELECT, UPDATE ON resident_auth_qr TO myapartment_resident_auth;
    GRANT SELECT(tenant_id, status) ON tenant_records TO myapartment_resident_auth;
  END IF;
END $$;
