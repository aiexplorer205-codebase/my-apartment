SET search_path TO block9_tenant, public;
ALTER TABLE residents
  ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS move_out_date DATE,
  ADD COLUMN IF NOT EXISTS final_meter_reading NUMERIC(14, 3),
  ADD COLUMN IF NOT EXISTS move_out_recorded_by TEXT,
  ADD COLUMN IF NOT EXISTS move_out_dues_minor BIGINT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'residents_lifecycle_dates_check') THEN
    ALTER TABLE residents ADD CONSTRAINT residents_lifecycle_dates_check
      CHECK (move_out_date IS NULL OR move_out_date >= start_date);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'residents_final_meter_reading_check') THEN
    ALTER TABLE residents ADD CONSTRAINT residents_final_meter_reading_check
      CHECK (final_meter_reading IS NULL OR final_meter_reading >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'residents_move_out_dues_check') THEN
    ALTER TABLE residents ADD CONSTRAINT residents_move_out_dues_check
      CHECK (move_out_dues_minor IS NULL OR move_out_dues_minor >= 0);
  END IF;
END $$;

ALTER TABLE resident_invitations
  ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE;

CREATE INDEX IF NOT EXISTS residents_unit_lifecycle_idx
  ON residents (unit_id, start_date, move_out_date)
  WHERE status = 'active';
