SET search_path TO block9_platform, public;
-- Retained across partial organization deletion so external cleanup is retryable.
CREATE TABLE storage_deletions (
  tenant_id TEXT PRIMARY KEY,
  requires_storage BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  database_purged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
