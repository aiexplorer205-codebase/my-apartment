-- Run against myapartment_platform_db as a database provisioning administrator.
-- Supply push_password with psql -v; the login can assume only the push role.
SELECT 'CREATE ROLE myapartment_push_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_push_platform') \gexec
ALTER ROLE myapartment_push_platform PASSWORD :'push_password';
GRANT myapartment_push_platform_dispatcher TO myapartment_push_platform;
GRANT CONNECT ON DATABASE myapartment_platform_db TO myapartment_push_platform;
