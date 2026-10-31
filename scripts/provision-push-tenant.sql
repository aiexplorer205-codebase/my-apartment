-- Run against myapartment_app_db as a database provisioning administrator.
-- Supply push_password with psql -v; the login can assume only the push role.
SELECT 'CREATE ROLE myapartment_push_tenant LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_push_tenant') \gexec
ALTER ROLE myapartment_push_tenant PASSWORD :'push_password';
GRANT myapartment_push_dispatcher TO myapartment_push_tenant;
GRANT CONNECT ON DATABASE myapartment_app_db TO myapartment_push_tenant;
