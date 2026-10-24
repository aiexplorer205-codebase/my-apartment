SET search_path TO block9_tenant, public;
ALTER TABLE complaints ADD COLUMN creation_hash TEXT;
CREATE TABLE complaint_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  complaint_id UUID NOT NULL,
  slot SMALLINT NOT NULL CHECK(slot BETWEEN 1 AND 3),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
  height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
  data BYTEA NOT NULL CHECK(octet_length(data) BETWEEN 1 AND 1048576),
  source_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(tenant_id,complaint_id) REFERENCES complaints(tenant_id,id),
  UNIQUE(complaint_id,slot)
);
CREATE INDEX complaint_photos_scope_idx ON complaint_photos(tenant_id,complaint_id);
