ALTER TABLE apartment_buildings
  ADD COLUMN IF NOT EXISTS flat_limit INTEGER
    CHECK (flat_limit IS NULL OR flat_limit BETWEEN 1 AND 20000);
