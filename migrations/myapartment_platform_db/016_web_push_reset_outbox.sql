SET search_path TO block9_platform, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_push_platform_dispatcher') THEN
    CREATE ROLE myapartment_push_platform_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_push_platform_dispatcher'
    AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Platform push dispatcher role must be restricted and NOLOGIN';
  END IF;
END $$;

CREATE TABLE push_reset_qr_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  qr_request_id UUID NOT NULL UNIQUE REFERENCES resident_auth_qr(id) ON DELETE CASCADE,
  channels TEXT[] NOT NULL DEFAULT ARRAY['push','email'] CHECK (channels <@ ARRAY['push','email']),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT
);
CREATE INDEX push_reset_qr_outbox_dispatch_idx ON push_reset_qr_outbox(next_attempt_at,created_at)
  WHERE completed_at IS NULL;

CREATE FUNCTION push_reset_qr_is_pending(request_id UUID) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path=block9_platform,pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM resident_auth_qr
    WHERE id=request_id AND purpose='reset' AND status='pending' AND expires_at>NOW()
  )
$$;
CREATE FUNCTION push_reset_qr_remaining_ttl(request_id UUID) RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path=block9_platform,pg_catalog AS $$
  SELECT GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (expires_at-NOW())))::INTEGER)
  FROM resident_auth_qr WHERE id=request_id AND purpose='reset' AND status='pending' AND expires_at>NOW()
$$;
REVOKE ALL ON FUNCTION push_reset_qr_is_pending(UUID),push_reset_qr_remaining_ttl(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_reset_qr_is_pending(UUID),push_reset_qr_remaining_ttl(UUID)
  TO myapartment_push_platform_dispatcher;

GRANT USAGE ON SCHEMA block9_platform TO myapartment_push_platform_dispatcher;
GRANT SELECT,UPDATE ON push_reset_qr_outbox TO myapartment_push_platform_dispatcher;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_platform') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON push_reset_qr_outbox TO myapartment_platform;
  END IF;
END $$;
