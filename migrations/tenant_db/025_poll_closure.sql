-- Preserve the planned schedule when an admin ends/cancels a poll early.
ALTER TABLE polls
  ADD COLUMN closed_at TIMESTAMPTZ,
  ADD COLUMN closed_by TEXT,
  ADD CONSTRAINT poll_closure_actor CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  ADD CONSTRAINT poll_closed_status CHECK (closed_at IS NULL OR status='archived');
CREATE FUNCTION protect_poll_closure() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL AND (
    NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
    OR NEW.status IS DISTINCT FROM OLD.status OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
    OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.results_retention_days IS DISTINCT FROM OLD.results_retention_days
  ) THEN RAISE EXCEPTION 'Recorded poll closure, schedule and retention are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER poll_closure_immutable BEFORE UPDATE ON polls FOR EACH ROW EXECUTE FUNCTION protect_poll_closure();
