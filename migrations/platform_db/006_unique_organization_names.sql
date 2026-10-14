CREATE UNIQUE INDEX IF NOT EXISTS tenant_records_org_name_ci_idx
  ON tenant_records (lower(btrim(org_name)));
