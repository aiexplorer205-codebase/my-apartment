SET search_path TO block9_platform, public;

-- Product credentials may append and inspect audit history, never rewrite it.
CREATE FUNCTION protect_platform_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Platform audit history is append-only';
END
$$;
CREATE TRIGGER platform_audit_append_only
  BEFORE UPDATE OR DELETE OR TRUNCATE ON platform_audit
  FOR EACH STATEMENT EXECUTE FUNCTION protect_platform_audit();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'myapartment_platform') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON platform_audit FROM myapartment_platform;
    GRANT SELECT, INSERT ON platform_audit TO myapartment_platform;
  END IF;
END $$;
