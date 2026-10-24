SET search_path TO block9_tenant, public;
ALTER TABLE billing_unit_inputs
  ADD COLUMN IF NOT EXISTS excluded_from_billing BOOLEAN NOT NULL DEFAULT FALSE;
