SELECT 'CREATE DATABASE myapartment_tenant_template'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'myapartment_tenant_template')\gexec

\connect myapartment_tenant_template
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
