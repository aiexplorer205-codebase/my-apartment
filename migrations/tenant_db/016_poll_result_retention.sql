ALTER TABLE polls
  ADD COLUMN IF NOT EXISTS results_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (results_retention_days IN (7, 30, 90));
