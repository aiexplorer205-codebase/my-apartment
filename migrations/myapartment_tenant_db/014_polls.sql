SET search_path TO block9_tenant, public;
CREATE TABLE IF NOT EXISTS polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  question TEXT NOT NULL CHECK (length(question) BETWEEN 3 AND 500),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  show_results_live BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'archived')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  position INTEGER NOT NULL,
  UNIQUE (poll_id, position), UNIQUE (poll_id, id)
);
-- Participation is kept separately so anonymous ballots never retain a link to their choice.
CREATE TABLE IF NOT EXISTS poll_participation (
  poll_id UUID NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, resident_id)
);
CREATE TABLE IF NOT EXISTS poll_ballots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL,
  option_id UUID NOT NULL,
  resident_id UUID REFERENCES residents (id) ON DELETE CASCADE,
  FOREIGN KEY (poll_id, option_id) REFERENCES poll_options (poll_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS poll_ballots_named_resident_idx ON poll_ballots (poll_id, resident_id) WHERE resident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS polls_tenant_schedule_idx ON polls (tenant_id, starts_at, ends_at);
