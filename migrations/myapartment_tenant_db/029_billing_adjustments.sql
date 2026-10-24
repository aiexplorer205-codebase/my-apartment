SET search_path TO block9_tenant, public;
CREATE TABLE billing_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL REFERENCES residents(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  invoice_item_id UUID REFERENCES invoice_items(id),
  kind TEXT NOT NULL CHECK(kind IN ('credit','debit')),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  category TEXT NOT NULL CHECK(category IN ('maintenance','water','sinking_fund','fees','round_off')),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),
  effective_date DATE NOT NULL,
  created_by TEXT NOT NULL,
  request_key UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,created_by,request_key)
);
CREATE INDEX billing_adjustments_invoice_idx ON billing_adjustments(invoice_id);
CREATE TABLE resident_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id UUID NOT NULL UNIQUE REFERENCES billing_adjustments(id),
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL REFERENCES residents(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE resident_credit_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_id UUID NOT NULL REFERENCES resident_credits(id),
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL REFERENCES residents(id),
  invoice_id UUID REFERENCES invoices(id),
  account_entry_id UUID UNIQUE REFERENCES account_entries(id),
  amount_minor BIGINT NOT NULL CHECK(amount_minor>0),
  reason TEXT NOT NULL,
  effective_date DATE NOT NULL,
  created_by TEXT NOT NULL,
  request_key UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((invoice_id IS NULL) <> (account_entry_id IS NULL)),
  UNIQUE(tenant_id,created_by,request_key)
);
CREATE INDEX resident_credit_uses_credit_idx ON resident_credit_uses(credit_id);
CREATE FUNCTION invoice_adjustment_total(invoice UUID) RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(CASE WHEN kind='debit' THEN amount_minor ELSE -amount_minor END),0)::bigint
  FROM billing_adjustments WHERE invoice_id=invoice
$$;
CREATE OR REPLACE VIEW invoice_payment_credits AS
SELECT id,invoice_id,amount_minor,currency,method,status,reference,created_at,confirmed_at,confirmed_by,report_id FROM payments
UNION ALL
SELECT a.id,a.invoice_id,a.amount_minor,'INR'::char(3),'opening_credit'::text,'confirmed'::text,
 'Applied opening resident credit'::text,a.created_at,a.created_at,a.created_by,NULL::uuid FROM opening_credit_allocations a
UNION ALL
SELECT a.id,a.invoice_id,a.amount_minor,'INR'::char(3),'adjustment_credit'::text,'confirmed'::text,
 a.reason,a.created_at,a.created_at,a.created_by,NULL::uuid FROM resident_credit_uses a WHERE a.invoice_id IS NOT NULL
UNION ALL
-- Reclassify overpaid allocations into available credit without a second cash receipt.
SELECT c.id,a.invoice_id,-c.amount_minor,'INR'::char(3),'resident_credit_origin'::text,'confirmed'::text,
 a.reason,c.created_at,c.created_at,a.created_by,NULL::uuid FROM resident_credits c JOIN billing_adjustments a ON a.id=c.adjustment_id;
CREATE FUNCTION protect_billing_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Billing corrections are immutable; post a linked correction'; END $$;
CREATE TRIGGER billing_adjustments_immutable BEFORE UPDATE OR DELETE ON billing_adjustments FOR EACH ROW EXECUTE FUNCTION protect_billing_correction();
CREATE TRIGGER resident_credits_immutable BEFORE UPDATE OR DELETE ON resident_credits FOR EACH ROW EXECUTE FUNCTION protect_billing_correction();
CREATE TRIGGER resident_credit_uses_immutable BEFORE UPDATE OR DELETE ON resident_credit_uses FOR EACH ROW EXECUTE FUNCTION protect_billing_correction();

-- Refunds are cash outflows, separately reported from vendor expenses.
ALTER TABLE account_entries DROP CONSTRAINT account_entries_entry_type_check;
ALTER TABLE account_entries ADD CONSTRAINT account_entries_entry_type_check CHECK(entry_type IN ('collection','expense','other_income','opening','reversal','refund'));
ALTER TABLE account_entries ADD CONSTRAINT account_entries_refund_amount_check CHECK(entry_type<>'refund' OR amount_minor<0);

CREATE FUNCTION protect_published_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT OLD.is_opening_balance AND OLD.status<>'draft' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Published invoices are immutable; issue an adjustment'; END IF;
    IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR NEW.status IN ('draft','void') THEN
      RAISE EXCEPTION 'Published invoices are immutable; issue an adjustment';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER published_invoice_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION protect_published_invoice();
CREATE FUNCTION protect_published_invoice_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM invoices WHERE id=OLD.invoice_id AND status<>'draft') THEN
    RAISE EXCEPTION 'Published invoice lines are immutable; issue an adjustment';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER published_invoice_line_immutable BEFORE UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION protect_published_invoice_line();
