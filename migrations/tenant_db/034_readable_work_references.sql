-- Keep UUID primary keys and relationships intact. Identity sequences assign
-- permanent, concurrency-safe display references to existing and future rows.
ALTER TABLE complaints
  ADD COLUMN reference_number BIGINT GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN reference TEXT GENERATED ALWAYS AS (
    'CMP-' || lpad(reference_number::text, greatest(6, length(reference_number::text)), '0')
  ) STORED;
CREATE UNIQUE INDEX complaints_reference_unique ON complaints(reference);

ALTER TABLE maintenance_tasks
  ADD COLUMN reference_number BIGINT GENERATED ALWAYS AS IDENTITY,
  ADD COLUMN reference TEXT GENERATED ALWAYS AS (
    'MNT-' || lpad(reference_number::text, greatest(6, length(reference_number::text)), '0')
  ) STORED;
CREATE UNIQUE INDEX maintenance_tasks_reference_unique ON maintenance_tasks(reference);
