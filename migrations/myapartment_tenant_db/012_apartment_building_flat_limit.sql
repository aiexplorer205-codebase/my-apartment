SET search_path TO block9_tenant, public;
ALTER TABLE apartment_buildings
  ADD COLUMN IF NOT EXISTS flat_limit INTEGER
    CHECK (flat_limit IS NULL OR flat_limit BETWEEN 1 AND 20000);
