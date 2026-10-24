SET search_path TO block9_tenant, public;
ALTER TABLE property_setup_deletions DROP CONSTRAINT IF EXISTS property_setup_deletions_target_kind_check;
ALTER TABLE property_setup_deletions ADD CONSTRAINT property_setup_deletions_target_kind_check
  CHECK (target_kind IN ('block', 'flat', 'setup'));
