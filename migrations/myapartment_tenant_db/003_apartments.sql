SET search_path TO block9_tenant, public;
CREATE TABLE IF NOT EXISTS apartments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  billing_start_month DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS apartment_buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  apartment_id UUID NOT NULL REFERENCES apartments (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  maintenance_rate_per_sqft NUMERIC(10, 2) CHECK (maintenance_rate_per_sqft IS NULL OR maintenance_rate_per_sqft >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, apartment_id, name)
);

ALTER TABLE apartments ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
ALTER TABLE apartment_buildings ADD COLUMN IF NOT EXISTS maintenance_rate_per_sqft NUMERIC(10, 2)
  CHECK (maintenance_rate_per_sqft IS NULL OR maintenance_rate_per_sqft >= 0);

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS apartment_id UUID REFERENCES apartments (id),
  ADD COLUMN IF NOT EXISTS apartment_building_id UUID REFERENCES apartment_buildings (id);

CREATE INDEX IF NOT EXISTS units_apartment_building_idx
  ON units (tenant_id, apartment_building_id);

CREATE INDEX IF NOT EXISTS apartment_buildings_tenant_apartment_idx
  ON apartment_buildings (tenant_id, apartment_id);
