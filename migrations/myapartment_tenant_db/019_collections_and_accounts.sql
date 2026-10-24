SET search_path TO block9_tenant, public;
-- A report represents one offline payment, with one or more invoice allocations.
CREATE TABLE IF NOT EXISTS payment_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL REFERENCES residents(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK(currency = 'INR'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed')),
  request_subject TEXT NOT NULL,
  request_key UUID NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by TEXT,
  account_name TEXT CHECK(account_name IN ('Cash','Bank')),
  reference TEXT,
  CHECK(status <> 'confirmed' OR (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND account_name IS NOT NULL AND length(trim(reference)) > 0)),
  UNIQUE(tenant_id, request_subject, request_key)
);
CREATE INDEX IF NOT EXISTS payment_reports_queue_idx ON payment_reports(tenant_id,status,created_at DESC);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS report_id UUID REFERENCES payment_reports(id);
-- Fresh-install contract: every allocation belongs to one payment report.
-- Existing ungrouped payment data requires an explicit migration, not guessed groups.
ALTER TABLE payments ALTER COLUMN report_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_report_invoice_uidx ON payments(report_id,invoice_id);
CREATE INDEX IF NOT EXISTS payments_report_idx ON payments(report_id);

-- Amounts are signed: receipts/income/opening funds positive, expenses negative.
-- Posted rows are immutable; a correction appends an opposite signed reversal.
CREATE TABLE IF NOT EXISTS account_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('collection','expense','other_income','opening','reversal')),
  account_name TEXT NOT NULL CHECK(account_name IN ('Cash','Bank')),
  entry_date DATE NOT NULL,
  amount_minor BIGINT NOT NULL CHECK(amount_minor <> 0),
  category TEXT NOT NULL,
  party TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('draft','posted')),
  report_id UUID UNIQUE REFERENCES payment_reports(id),
  reverses_id UUID UNIQUE REFERENCES account_entries(id),
  reason TEXT,
  created_by TEXT NOT NULL,
  request_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(entry_type <> 'collection' OR (report_id IS NOT NULL AND amount_minor > 0 AND status='posted')),
  CHECK(entry_type <> 'expense' OR amount_minor < 0),
  CHECK(entry_type <> 'other_income' OR amount_minor > 0),
  CHECK(entry_type <> 'reversal' OR (reverses_id IS NOT NULL AND length(trim(reason)) > 0)),
  UNIQUE(tenant_id,created_by,request_key)
);
CREATE INDEX IF NOT EXISTS account_entries_period_idx ON account_entries(tenant_id,account_name,entry_date);
CREATE OR REPLACE FUNCTION protect_posted_account_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Posted account entries are immutable; append a reversal instead';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS account_entries_immutable ON account_entries;
CREATE TRIGGER account_entries_immutable BEFORE UPDATE OR DELETE ON account_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_account_entry();
