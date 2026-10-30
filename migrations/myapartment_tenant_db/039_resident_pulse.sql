SET search_path TO block9_tenant, public;

CREATE TABLE resident_change_versions (
  tenant_id TEXT NOT NULL REFERENCES organizations(tenant_id) ON DELETE CASCADE,
  entity TEXT NOT NULL CHECK (entity IN ('notices','polls','updates','home')),
  version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, entity)
);

INSERT INTO resident_change_versions(tenant_id, entity)
SELECT o.tenant_id, entity
FROM organizations o
CROSS JOIN unnest(ARRAY['notices','polls','updates','home']) AS e(entity)
ON CONFLICT (tenant_id, entity) DO NOTHING;

CREATE FUNCTION bump_resident_change_versions() RETURNS trigger
LANGUAGE plpgsql SET search_path=block9_tenant,pg_catalog AS $$
DECLARE target_tenant TEXT;
BEGIN
  target_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  IF TG_TABLE_NAME='notices' THEN
    INSERT INTO resident_change_versions(tenant_id,entity,version,updated_at)
    VALUES(target_tenant,'notices',1,NOW()),(target_tenant,'updates',1,NOW()),(target_tenant,'home',1,NOW())
    ON CONFLICT(tenant_id,entity) DO UPDATE SET version=resident_change_versions.version+1,updated_at=NOW();
  ELSE
    INSERT INTO resident_change_versions(tenant_id,entity,version,updated_at)
    VALUES(target_tenant,'polls',1,NOW()),(target_tenant,'updates',1,NOW()),(target_tenant,'home',1,NOW())
    ON CONFLICT(tenant_id,entity) DO UPDATE SET version=resident_change_versions.version+1,updated_at=NOW();
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER resident_notice_versions
AFTER INSERT OR UPDATE OR DELETE ON notices
FOR EACH ROW EXECUTE FUNCTION bump_resident_change_versions();

CREATE TRIGGER resident_poll_versions
AFTER INSERT OR UPDATE OR DELETE ON polls
FOR EACH ROW EXECUTE FUNCTION bump_resident_change_versions();

ALTER TABLE resident_change_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resident_change_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON resident_change_versions TO myapartment_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
GRANT SELECT, INSERT, UPDATE, DELETE ON resident_change_versions TO myapartment_runtime;

CREATE INDEX IF NOT EXISTS resident_poll_participation_resident_idx ON poll_participation(resident_id, poll_id);
