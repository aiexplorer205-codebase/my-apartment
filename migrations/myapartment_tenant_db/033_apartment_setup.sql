SET search_path TO block9_tenant, public;
-- A reviewed setup is immutable; confirmation records its result in the same transaction.
ALTER TABLE apartment_buildings ADD COLUMN IF NOT EXISTS floors INTEGER NOT NULL DEFAULT 1 CHECK (floors BETWEEN 1 AND 200);
UPDATE apartment_buildings b SET floors = GREATEST(b.floors, COALESCE((SELECT MAX(u.floor_number) FROM units u WHERE u.apartment_building_id = b.id), 1));
CREATE TABLE IF NOT EXISTS apartment_setup_reviews (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  payload JSONB NOT NULL,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS apartment_setup_reviews_actor_idx ON apartment_setup_reviews(tenant_id, created_by, created_at DESC);
