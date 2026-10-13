SELECT 'CREATE DATABASE tenant_template'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'tenant_template')\gexec

\connect tenant_template
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
