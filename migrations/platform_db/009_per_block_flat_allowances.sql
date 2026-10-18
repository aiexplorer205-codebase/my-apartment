ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS allowed_flats_per_block INTEGER[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'tenant_records'::regclass
      AND conname = 'tenant_records_flat_allowances_check'
  ) THEN
    ALTER TABLE tenant_records
      ADD CONSTRAINT tenant_records_flat_allowances_check
      CHECK (
        allowed_flats_per_block IS NULL
        OR (
          cardinality(allowed_flats_per_block) = allowed_blocks
          AND array_position(allowed_flats_per_block, NULL) IS NULL
          AND 1 <= ALL (allowed_flats_per_block)
          AND 20000 >= ALL (allowed_flats_per_block)
        )
      );
  END IF;
END $$;
