SET search_path TO block9_tenant, public;

CREATE TABLE meeting_minutes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  meeting_at TIMESTAMPTZ,
  location TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  attendance_not_recorded BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  published_by TEXT,
  CHECK ((status = 'draft' AND published_at IS NULL AND published_by IS NULL) OR
    (status = 'published' AND published_at IS NOT NULL AND published_by IS NOT NULL
      AND meeting_at IS NOT NULL AND meeting_at <= published_at
      AND length(btrim(title)) > 0 AND length(btrim(notes)) > 0))
);
CREATE INDEX meeting_minutes_latest_idx ON meeting_minutes
  (tenant_id, status, meeting_at DESC, published_at DESC, id DESC);
CREATE INDEX meeting_minutes_admin_idx ON meeting_minutes (tenant_id, updated_at DESC, id DESC);

CREATE TABLE meeting_minutes_attendees (
  meeting_id UUID NOT NULL REFERENCES meeting_minutes(id),
  resident_id UUID NOT NULL REFERENCES residents(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  full_name TEXT NOT NULL,
  block_name TEXT NOT NULL,
  flat_number TEXT NOT NULL,
  PRIMARY KEY (meeting_id, resident_id)
);
CREATE INDEX meeting_minutes_attendees_unit_idx ON meeting_minutes_attendees(unit_id);
CREATE INDEX meeting_minutes_attendees_resident_idx ON meeting_minutes_attendees(resident_id);

ALTER TABLE communication_publications DROP CONSTRAINT communication_publications_kind_check;
ALTER TABLE communication_publications ADD CONSTRAINT communication_publications_kind_check
  CHECK (kind IN ('announcement', 'poll', 'meeting_minutes', 'meeting_minutes_draft'));

-- Published content and attendance are durable history, including for direct SQL writes.
CREATE FUNCTION guard_meeting_minutes_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Published meeting minutes cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.status = 'published' THEN
    IF NEW.attendance_not_recorded = EXISTS(SELECT 1 FROM meeting_minutes_attendees WHERE meeting_id = NEW.id) THEN
      RAISE EXCEPTION 'Record attendance or confirm attendance not recorded' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meeting_minutes_history BEFORE UPDATE OR DELETE ON meeting_minutes
  FOR EACH ROW EXECUTE FUNCTION guard_meeting_minutes_history();

CREATE FUNCTION guard_meeting_minutes_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id UUID;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM 1 FROM meeting_minutes WHERE id = OLD.meeting_id AND status = 'draft' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Published attendance cannot be changed' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    parent_id := NEW.meeting_id;
    PERFORM 1 FROM meeting_minutes WHERE id = parent_id AND status = 'draft' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Published attendance cannot be changed' USING ERRCODE = '23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM residents r JOIN units u ON u.id = r.unit_id
      JOIN meeting_minutes m ON m.id = parent_id
      WHERE r.id = NEW.resident_id AND u.id = NEW.unit_id AND u.tenant_id = m.tenant_id) THEN
      RAISE EXCEPTION 'Attendance must belong to this apartment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER meeting_minutes_attendance_history BEFORE INSERT OR UPDATE OR DELETE ON meeting_minutes_attendees
  FOR EACH ROW EXECUTE FUNCTION guard_meeting_minutes_attendance();
