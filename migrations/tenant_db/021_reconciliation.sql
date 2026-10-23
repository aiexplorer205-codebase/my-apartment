CREATE TABLE IF NOT EXISTS account_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  account_name TEXT NOT NULL CHECK(account_name IN ('Cash','Bank')),
  period DATE NOT NULL CHECK(period = date_trunc('month',period)::date),
  statement_opening_minor BIGINT NOT NULL,
  statement_closing_minor BIGINT NOT NULL,
  statement_reference TEXT NOT NULL CHECK(length(trim(statement_reference)) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized')),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,
  finalized_by TEXT,
  finalized_snapshot TEXT,
  UNIQUE(tenant_id,account_name,period),
  CHECK(status <> 'finalized' OR (finalized_at IS NOT NULL AND finalized_by IS NOT NULL AND finalized_snapshot IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS account_reconciliation_matches (
  reconciliation_id UUID NOT NULL REFERENCES account_reconciliations(id),
  entry_id UUID NOT NULL UNIQUE REFERENCES account_entries(id),
  matched_by TEXT NOT NULL,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(reconciliation_id,entry_id)
);
CREATE TABLE IF NOT EXISTS account_reconciliation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  reconciliation_id UUID NOT NULL REFERENCES account_reconciliations(id),
  actor_subject TEXT NOT NULL,
  request_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('save','finalize','reopen')),
  reason TEXT,
  snapshot JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,actor_subject,request_key)
);
CREATE INDEX IF NOT EXISTS account_reconciliation_closed_idx ON account_reconciliations(tenant_id,account_name,period) WHERE status='finalized';

-- Serialize ledger posting with reconciliation and prohibit late changes to a
-- finalized account period, including entries that would change its opening.
CREATE OR REPLACE FUNCTION enforce_reconciled_account_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'posted' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id || ':account-writes',0));
    IF EXISTS(SELECT 1 FROM account_reconciliations r WHERE r.tenant_id=NEW.tenant_id AND r.account_name=NEW.account_name AND r.status='finalized' AND NEW.entry_date < r.period + INTERVAL '1 month') THEN
      RAISE EXCEPTION 'This account period is finalized. Reopen reconciliation before posting a backdated entry.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS account_entries_period_guard ON account_entries;
CREATE TRIGGER account_entries_period_guard BEFORE INSERT OR UPDATE ON account_entries
FOR EACH ROW EXECUTE FUNCTION enforce_reconciled_account_period();
