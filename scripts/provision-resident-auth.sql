-- Run with psql as a provisioning administrator; supply auth_password as a psql variable.
-- No superuser or CREATEDB privilege is required for the application login.
SELECT 'CREATE ROLE myapartment_resident_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_resident_auth') \gexec
ALTER ROLE myapartment_resident_auth PASSWORD :'auth_password';
SELECT format('GRANT CONNECT ON DATABASE %I TO myapartment_resident_auth', current_database()) \gexec
GRANT USAGE ON SCHEMA block9_platform TO myapartment_resident_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE block9_platform.resident_auth_user, block9_platform.resident_auth_session,
  block9_platform.resident_auth_account, block9_platform.resident_auth_verification, block9_platform.resident_auth_passkey,
  block9_platform.resident_auth_rate_limit, block9_platform.resident_auth_email_limit TO myapartment_resident_auth;
GRANT INSERT ON block9_platform.resident_auth_audit TO myapartment_resident_auth;
GRANT USAGE ON SEQUENCE block9_platform.resident_auth_audit_id_seq TO myapartment_resident_auth;
REVOKE ALL ON TABLE block9_platform.resident_auth_user, block9_platform.resident_auth_session,
  block9_platform.resident_auth_account, block9_platform.resident_auth_verification, block9_platform.resident_auth_passkey,
  block9_platform.resident_auth_rate_limit, block9_platform.resident_auth_email_limit, block9_platform.resident_auth_audit FROM myapartment_platform;

GRANT SELECT, UPDATE ON block9_platform.resident_auth_qr TO myapartment_resident_auth;
GRANT SELECT(tenant_id, status) ON block9_platform.tenant_records TO myapartment_resident_auth;
