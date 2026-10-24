-- Keep each surviving block's allowance slot when another block is removed.
ALTER TABLE apartment_buildings ADD COLUMN IF NOT EXISTS allowance_slot INTEGER;
WITH ordered AS (
  SELECT id, (row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) - 1)::int AS slot
  FROM apartment_buildings
)
UPDATE apartment_buildings b SET allowance_slot = ordered.slot FROM ordered
WHERE b.id = ordered.id AND b.allowance_slot IS NULL;
ALTER TABLE apartment_buildings ALTER COLUMN allowance_slot SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS apartment_buildings_allowance_slot_idx
  ON apartment_buildings (tenant_id, allowance_slot);

CREATE TABLE IF NOT EXISTS property_setup_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  deleted_by TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('block', 'flat')),
  target_id UUID NOT NULL,
  target_name TEXT NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS property_setup_deletions_tenant_idx
  ON property_setup_deletions (tenant_id, created_at DESC);

-- Preserve compatibility with existing provisioning paths that omit the slot.
CREATE OR REPLACE FUNCTION assign_block_allowance_slot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.allowance_slot IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id));
    SELECT candidate INTO NEW.allowance_slot
    FROM generate_series(0, (SELECT COUNT(*)::int FROM apartment_buildings WHERE tenant_id = NEW.tenant_id)) candidate
    WHERE NOT EXISTS (SELECT 1 FROM apartment_buildings b WHERE b.tenant_id = NEW.tenant_id AND b.allowance_slot = candidate)
    ORDER BY candidate LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS assign_block_allowance_slot ON apartment_buildings;
CREATE TRIGGER assign_block_allowance_slot BEFORE INSERT ON apartment_buildings
  FOR EACH ROW EXECUTE FUNCTION assign_block_allowance_slot();
