-- Run with psql as a provisioning administrator; supply auth_password as a psql variable.
-- No superuser or CREATEDB privilege is required for the application login.
SELECT 'CREATE ROLE myapartment_admin_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_admin_auth') \gexec
ALTER ROLE myapartment_admin_auth PASSWORD :'auth_password';
SELECT format('GRANT CONNECT ON DATABASE %I TO myapartment_admin_auth', current_database()) \gexec
GRANT USAGE ON SCHEMA block9_platform TO myapartment_admin_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE block9_platform.admin_auth_user, block9_platform.admin_auth_session,
  block9_platform.admin_auth_account, block9_platform.admin_auth_verification, block9_platform.admin_auth_passkey,
  block9_platform.admin_auth_rate_limit, block9_platform.admin_auth_email_limit TO myapartment_admin_auth;
GRANT INSERT ON block9_platform.admin_auth_audit TO myapartment_admin_auth;
GRANT USAGE ON SEQUENCE block9_platform.admin_auth_audit_id_seq TO myapartment_admin_auth;
REVOKE ALL ON TABLE block9_platform.admin_auth_user, block9_platform.admin_auth_session,
  block9_platform.admin_auth_account, block9_platform.admin_auth_verification, block9_platform.admin_auth_passkey,
  block9_platform.admin_auth_rate_limit, block9_platform.admin_auth_email_limit, block9_platform.admin_auth_audit FROM myapartment_platform;
