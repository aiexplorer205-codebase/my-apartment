CREATE SCHEMA IF NOT EXISTS block9_platform;
SET search_path TO block9_platform, public;
CREATE TABLE IF NOT EXISTS tenant_records (
  id UUID PRIMARY KEY,
  tenant_id TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  org_name TEXT NOT NULL,
  status TEXT NOT NULL,
  database_locator TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provisioning_state (
  id UUID PRIMARY KEY,
  tenant_id TEXT UNIQUE NOT NULL,
  database_locator TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  last_error TEXT,
  schema_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity_subjects (
  id UUID PRIMARY KEY,
  subject TEXT UNIQUE NOT NULL,
  tenant_id TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
