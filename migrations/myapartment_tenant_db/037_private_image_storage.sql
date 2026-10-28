SET search_path TO block9_tenant, public;
-- No customer binary migration is inferred. Historical SQL still establishes the
-- empty base schema; new uploads exclusively use private object storage.
ALTER TABLE complaint_photos DROP COLUMN data;
ALTER TABLE complaint_photos ADD COLUMN upload_id UUID NOT NULL;
ALTER TABLE complaint_photos ADD COLUMN byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576);
ALTER TABLE complaint_photos ADD COLUMN expires_at TIMESTAMPTZ NOT NULL;
CREATE TABLE photo_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id',true),''),
  subject TEXT NOT NULL,
  request_key UUID NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  input_size INTEGER NOT NULL CHECK(input_size BETWEEN 1 AND 1048576),
  input_sha256 TEXT NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
  staging_key TEXT NOT NULL UNIQUE,
  object_key TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','validating','ready','attached','rejected','expired')),
  cleaned_at TIMESTAMPTZ,
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER,
  source_hash TEXT,
  retention_days INTEGER NOT NULL CHECK(retention_days IN (30,90,180,365)),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  intent_expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '15 minutes',
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,subject,request_key),
  CHECK(state NOT IN ('ready','attached') OR (object_key IS NOT NULL AND width BETWEEN 1 AND 1600 AND height BETWEEN 1 AND 1600 AND byte_size BETWEEN 1 AND 1048576 AND source_hash IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE INDEX photo_uploads_owner_created ON photo_uploads(tenant_id,subject,created_at);
CREATE INDEX photo_uploads_cleanup ON photo_uploads(tenant_id,state,created_at);
ALTER TABLE photo_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_uploads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON photo_uploads TO myapartment_runtime
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
GRANT SELECT,INSERT,UPDATE,DELETE ON photo_uploads TO myapartment_runtime;
ALTER TABLE complaint_photos ADD CONSTRAINT complaint_photos_upload_fk FOREIGN KEY(tenant_id,upload_id) REFERENCES photo_uploads(tenant_id,id);
ALTER TABLE complaint_photos ADD CONSTRAINT complaint_photos_upload_unique UNIQUE(tenant_id,upload_id);
-- Record every candidate before writing it. A crash or failed compensating delete
-- must not hide orphaned final objects from periodic cleanup.
CREATE TABLE photo_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL DEFAULT nullif(current_setting('app.tenant_id',true),''),
  upload_id UUID NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after TIMESTAMPTZ NOT NULL DEFAULT now()+interval '1 day',
  deleted_at TIMESTAMPTZ,
  FOREIGN KEY(tenant_id,upload_id) REFERENCES photo_uploads(tenant_id,id)
);
CREATE INDEX photo_objects_cleanup ON photo_objects(tenant_id,delete_after) WHERE deleted_at IS NULL;
ALTER TABLE photo_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE photo_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON photo_objects TO myapartment_runtime
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),''));
GRANT SELECT,INSERT,UPDATE,DELETE ON photo_objects TO myapartment_runtime;
