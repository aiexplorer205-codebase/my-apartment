-- Keep anonymous ballot choices addressable for edits without storing a resident
-- identifier on the ballot. Only the poll voting API follows this reference.
ALTER TABLE poll_participation
  ADD COLUMN IF NOT EXISTS ballot_id UUID;

DO $$ BEGIN
  ALTER TABLE poll_participation
    ADD CONSTRAINT poll_participation_ballot_fk
    FOREIGN KEY (ballot_id) REFERENCES poll_ballots (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS poll_participation_ballot_idx
  ON poll_participation (ballot_id) WHERE ballot_id IS NOT NULL;
