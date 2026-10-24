SET search_path TO block9_platform, public;
CREATE SEQUENCE IF NOT EXISTS apartment_code_seq START WITH 1;

ALTER TABLE tenant_records
  ADD COLUMN IF NOT EXISTS apartment_code TEXT;

UPDATE tenant_records
SET apartment_code = 'APT-' || LPAD(nextval('apartment_code_seq')::text, 6, '0')
WHERE apartment_code IS NULL;

ALTER TABLE tenant_records
  ALTER COLUMN apartment_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_records_apartment_code_idx
  ON tenant_records (apartment_code);

DROP INDEX IF EXISTS tenant_records_org_name_ci_idx;
