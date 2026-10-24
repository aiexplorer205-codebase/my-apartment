SET search_path TO block9_tenant, public;
CREATE TABLE IF NOT EXISTS resident_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  batch_id UUID NOT NULL,
  row_number INTEGER NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'sent', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS resident_import_rows_tenant_idx ON resident_import_rows (tenant_id, created_at DESC);
ALTER TABLE resident_invitations ADD COLUMN IF NOT EXISTS bulk_row_id UUID REFERENCES resident_import_rows(id);
