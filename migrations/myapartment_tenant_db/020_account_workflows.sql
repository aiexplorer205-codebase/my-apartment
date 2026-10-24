SET search_path TO block9_tenant, public;
ALTER TABLE account_entries
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS replaces_id UUID UNIQUE REFERENCES account_entries(id),
  ADD COLUMN IF NOT EXISTS maintenance_task_id UUID REFERENCES maintenance_tasks(id),
  ADD COLUMN IF NOT EXISTS complaint_id UUID REFERENCES complaints(id);
