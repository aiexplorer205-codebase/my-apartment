SET search_path TO block9_tenant, public;
CREATE TABLE IF NOT EXISTS account_cutovers (
  tenant_id TEXT PRIMARY KEY,
  cutover_date DATE NOT NULL CHECK(cutover_date=date_trunc('month',cutover_date)::date),
  latest_batch_id UUID,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS account_opening_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  payload JSONB NOT NULL,
  source_fingerprint TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '15 minutes',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS account_opening_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES account_cutovers(tenant_id),
  preview_id UUID NOT NULL UNIQUE REFERENCES account_opening_previews(id),
  previous_batch_id UUID UNIQUE REFERENCES account_opening_batches(id),
  payload JSONB NOT NULL,
  created_by TEXT NOT NULL,
  request_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,created_by,request_key)
);
ALTER TABLE account_cutovers DROP CONSTRAINT IF EXISTS account_cutovers_latest_batch_id_fkey;
ALTER TABLE account_cutovers ADD CONSTRAINT account_cutovers_latest_batch_id_fkey FOREIGN KEY(latest_batch_id) REFERENCES account_opening_batches(id);
ALTER TABLE account_entries ADD COLUMN IF NOT EXISTS opening_batch_id UUID REFERENCES account_opening_batches(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_opening_balance BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_resident_id_billing_period_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_resident_month_normal_uidx ON invoices(resident_id,billing_period) WHERE NOT is_opening_balance;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_resident_opening_current_uidx ON invoices(resident_id) WHERE is_opening_balance AND status<>'void';
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_category_check;
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_category_check CHECK(category IN ('maintenance','water','sinking_fund','previous_dues','fees','round_off','opening_balance'));
CREATE TABLE IF NOT EXISTS resident_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL REFERENCES residents(id),
  batch_id UUID NOT NULL REFERENCES account_opening_batches(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor<>0),
  invoice_id UUID UNIQUE REFERENCES invoices(id),
  superseded_by UUID REFERENCES account_opening_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((amount_minor>0 AND invoice_id IS NOT NULL) OR (amount_minor<0 AND invoice_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS resident_opening_current_uidx ON resident_opening_balances(tenant_id,resident_id) WHERE superseded_by IS NULL;
CREATE TABLE IF NOT EXISTS opening_credit_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opening_id UUID NOT NULL REFERENCES resident_opening_balances(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  created_by TEXT NOT NULL,
  request_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(opening_id,invoice_id,request_key)
);
CREATE TABLE IF NOT EXISTS opening_credit_actions (
  tenant_id TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  request_key UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,actor_subject,request_key)
);

-- Numeric invoice credits include cash payments and explicit non-cash opening
-- credit allocations. Cash collections continue to read payments/payment_reports.
CREATE OR REPLACE VIEW invoice_payment_credits AS
SELECT id,invoice_id,amount_minor,currency,method,status,reference,created_at,confirmed_at,confirmed_by,report_id FROM payments
UNION ALL
SELECT a.id,a.invoice_id,a.amount_minor,'INR'::char(3),'opening_credit'::text,'confirmed'::text,
  'Applied opening resident credit'::text,a.created_at,a.created_at,a.created_by,NULL::uuid
FROM opening_credit_allocations a;

CREATE OR REPLACE FUNCTION protect_opening_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Opening source records are immutable'; END IF;
  IF TG_TABLE_NAME='resident_opening_balances' THEN
    IF (to_jsonb(NEW)-'superseded_by')=(to_jsonb(OLD)-'superseded_by') AND OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Opening source records are immutable; post a reviewed correction';
END;
$$;
DROP TRIGGER IF EXISTS resident_opening_immutable ON resident_opening_balances;
CREATE TRIGGER resident_opening_immutable BEFORE UPDATE OR DELETE ON resident_opening_balances FOR EACH ROW EXECUTE FUNCTION protect_opening_source();
DROP TRIGGER IF EXISTS opening_batches_immutable ON account_opening_batches;
CREATE TRIGGER opening_batches_immutable BEFORE UPDATE OR DELETE ON account_opening_batches FOR EACH ROW EXECUTE FUNCTION protect_opening_source();
DROP TRIGGER IF EXISTS opening_allocations_immutable ON opening_credit_allocations;
CREATE TRIGGER opening_allocations_immutable BEFORE UPDATE OR DELETE ON opening_credit_allocations FOR EACH ROW EXECUTE FUNCTION protect_opening_source();

-- Imported funds already include earlier movements. Do not allow an ordinary
-- posting to be added again before the cutover. Capital opening reversals are
-- allowed so an unused cutover can be moved with an auditable cancellation.
CREATE OR REPLACE FUNCTION enforce_reconciled_account_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='posted' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id || ':account-writes',0));
    IF NEW.entry_type<>'opening' AND NOT(NEW.entry_type='reversal' AND EXISTS(SELECT 1 FROM account_entries original WHERE original.id=NEW.reverses_id AND original.entry_type='opening')) AND
       EXISTS(SELECT 1 FROM account_cutovers c WHERE c.tenant_id=NEW.tenant_id AND NEW.entry_date<c.cutover_date) THEN
      RAISE EXCEPTION 'Transactions cannot predate the opening cutover. Starting funds already include earlier activity.' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM account_reconciliations r WHERE r.tenant_id=NEW.tenant_id AND r.account_name=NEW.account_name AND r.status='finalized' AND NEW.entry_date<r.period+INTERVAL '1 month') THEN
      RAISE EXCEPTION 'This account period is finalized. Reopen reconciliation before posting a backdated entry.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_opening_invoice_cutover() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope_tenant TEXT;
BEGIN
  IF NOT NEW.is_opening_balance THEN
    SELECT u.tenant_id INTO scope_tenant FROM residents r JOIN units u ON u.id=r.unit_id WHERE r.id=NEW.resident_id;
    PERFORM pg_advisory_xact_lock(hashtextextended(scope_tenant || ':account-writes',0));
    IF EXISTS(SELECT 1 FROM account_cutovers c WHERE c.tenant_id=scope_tenant AND NEW.billing_period<c.cutover_date) THEN
      RAISE EXCEPTION 'New billing cannot predate the opening cutover. Earlier debt must be represented once in the opening source.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invoices_opening_cutover_guard ON invoices;
CREATE TRIGGER invoices_opening_cutover_guard BEFORE INSERT ON invoices FOR EACH ROW EXECUTE FUNCTION enforce_opening_invoice_cutover();
