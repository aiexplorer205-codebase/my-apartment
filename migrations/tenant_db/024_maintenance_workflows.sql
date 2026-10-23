-- Durable task checks and reviewed, retry-safe maintenance actions.
CREATE OR REPLACE FUNCTION valid_maintenance_checklist(value JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item JSONB; seen TEXT[] := '{}'; item_id TEXT;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' OR jsonb_array_length(value)>30 THEN RETURN FALSE; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'done') IS DISTINCT FROM 'boolean' OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
      OR length(trim(item->>'label')) NOT BETWEEN 1 AND 160 THEN RETURN FALSE; END IF;
    item_id:=item->>'id';
    IF item_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR item_id=ANY(seen) THEN RETURN FALSE; END IF;
    seen:=array_append(seen,item_id);
  END LOOP;
  RETURN TRUE;
END $$;
ALTER TABLE complaints ADD CONSTRAINT complaints_tenant_id_unique UNIQUE(tenant_id,id);
ALTER TABLE maintenance_tasks
  ADD COLUMN checklist JSONB NOT NULL DEFAULT '[]' CHECK(valid_maintenance_checklist(checklist)),
  ADD COLUMN complaint_id UUID,
  ADD COLUMN creation_hash TEXT,
  ADD CONSTRAINT maintenance_complaint_tenant_fk FOREIGN KEY(tenant_id,complaint_id) REFERENCES complaints(tenant_id,id),
  ADD CONSTRAINT completed_maintenance_checks CHECK(status <> 'Completed' OR NOT jsonb_path_exists(checklist,'$[*] ? (@.done == false)'));
CREATE TABLE maintenance_actions (
  task_id UUID NOT NULL REFERENCES maintenance_tasks(id),
  actor_subject TEXT NOT NULL,
  request_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('checklist','complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(task_id,actor_subject,request_key)
);
CREATE INDEX maintenance_complaint_idx ON maintenance_tasks(tenant_id,complaint_id);
