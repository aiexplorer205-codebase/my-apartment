-- A credit action has a stable record identity independent of its allocations.
-- Fresh-install migration: credit action/allocation data is created by the API.
ALTER TABLE opening_credit_actions
  ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS resident_id UUID NOT NULL REFERENCES residents(id);
CREATE UNIQUE INDEX IF NOT EXISTS opening_credit_actions_id_uidx ON opening_credit_actions(id);
ALTER TABLE opening_credit_allocations
  ADD COLUMN IF NOT EXISTS action_id UUID NOT NULL REFERENCES opening_credit_actions(id);
CREATE UNIQUE INDEX IF NOT EXISTS opening_credit_action_invoice_uidx ON opening_credit_allocations(action_id,invoice_id);
CREATE INDEX IF NOT EXISTS payment_reports_resident_history_idx ON payment_reports(tenant_id,resident_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS opening_credit_resident_history_idx ON opening_credit_actions(tenant_id,resident_id,created_at DESC,id);
