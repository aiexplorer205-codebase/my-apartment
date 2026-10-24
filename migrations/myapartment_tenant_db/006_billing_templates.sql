SET search_path TO block9_tenant, public;
ALTER TABLE billing_rules
  ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 'standard'
    CHECK (template IN ('standard', 'metered_water', 'area_based')),
  ADD COLUMN IF NOT EXISTS maintenance_rate_per_sqft_minor BIGINT NOT NULL DEFAULT 0
    CHECK (maintenance_rate_per_sqft_minor >= 0),
  ADD COLUMN IF NOT EXISTS water_rate_per_kl_minor BIGINT NOT NULL DEFAULT 0
    CHECK (water_rate_per_kl_minor >= 0);

CREATE TABLE IF NOT EXISTS billing_unit_inputs (
  billing_period DATE NOT NULL,
  unit_id UUID NOT NULL REFERENCES units (id),
  opening_meter_reading NUMERIC(14, 3) CHECK (opening_meter_reading IS NULL OR opening_meter_reading >= 0),
  closing_meter_reading NUMERIC(14, 3) CHECK (closing_meter_reading IS NULL OR closing_meter_reading >= 0),
  extra_charge_minor BIGINT NOT NULL DEFAULT 0 CHECK (extra_charge_minor >= 0),
  extra_charge_description TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (billing_period, unit_id)
);

CREATE INDEX IF NOT EXISTS billing_unit_inputs_unit_period_idx
  ON billing_unit_inputs (unit_id, billing_period DESC);
