CREATE TABLE IF NOT EXISTS complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL REFERENCES residents(id),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 4 AND 160),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 6000),
  category TEXT NOT NULL CHECK (category IN ('Plumbing','Electrical','Lift','Water supply','Cleaning','Security','Common area','Other')),
  location TEXT NOT NULL CHECK (length(location) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In progress','Awaiting resident','Resolved','Closed')),
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal','Urgent')),
  assigned_subject TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  request_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, resident_id, request_key)
);
CREATE INDEX IF NOT EXISTS complaints_tenant_status_idx ON complaints(tenant_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS complaint_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES complaints(id),
  actor_subject TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('resident','admin')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 6000),
  internal BOOLEAN NOT NULL DEFAULT FALSE,
  request_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT internal OR actor_role = 'admin'),
  UNIQUE(complaint_id, actor_subject, request_key)
);
CREATE INDEX IF NOT EXISTS complaint_messages_thread_idx ON complaint_messages(complaint_id, created_at);
CREATE TABLE IF NOT EXISTS complaint_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id UUID NOT NULL REFERENCES complaints(id),
  actor_subject TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
