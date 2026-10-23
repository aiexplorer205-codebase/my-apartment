CREATE TABLE IF NOT EXISTS maintenance_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 4 AND 160),
  location TEXT NOT NULL CHECK(length(location) BETWEEN 1 AND 240),
  due_date DATE NOT NULL,
  owner_subject TEXT,
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 6000),
  status TEXT NOT NULL DEFAULT 'Planned' CHECK(status IN ('Planned','Completed')),
  completion_note TEXT,
  completed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  request_key UUID NOT NULL,
  completion_request_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(status <> 'Completed' OR (length(trim(completion_note)) > 0 AND completed_at IS NOT NULL)),
  UNIQUE(tenant_id, created_by, request_key)
);
CREATE INDEX IF NOT EXISTS maintenance_tasks_due_idx ON maintenance_tasks(tenant_id, due_date);
