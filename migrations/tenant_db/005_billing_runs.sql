CREATE TABLE IF NOT EXISTS billing_rules (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  maintenance_minor BIGINT NOT NULL DEFAULT 0 CHECK (maintenance_minor >= 0),
  water_minor BIGINT NOT NULL DEFAULT 0 CHECK (water_minor >= 0),
  sinking_fund_minor BIGINT NOT NULL DEFAULT 0 CHECK (sinking_fund_minor >= 0),
  due_day SMALLINT NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
  grace_period_days SMALLINT NOT NULL DEFAULT 0 CHECK (grace_period_days BETWEEN 0 AND 90),
  late_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (late_fee_minor >= 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_period DATE NOT NULL UNIQUE,
  due_date DATE NOT NULL,
  invoice_count INTEGER NOT NULL CHECK (invoice_count >= 0),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  published_by TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_run_id UUID REFERENCES billing_runs (id);
CREATE INDEX IF NOT EXISTS invoices_billing_run_idx ON invoices (billing_run_id);
CREATE SEQUENCE IF NOT EXISTS invoice_number_sequence;
