SET search_path TO block9_tenant, public;
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#1d4ed8';

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS building_name TEXT NOT NULL DEFAULT 'Main building',
  ADD COLUMN IF NOT EXISTS floor_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS area_sqft INTEGER,
  ADD COLUMN IF NOT EXISTS maintenance_minor BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS units_tenant_number_uidx
  ON units (tenant_id, number);

CREATE TABLE IF NOT EXISTS residents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject TEXT NOT NULL UNIQUE,
  unit_id UUID NOT NULL REFERENCES units (id),
  full_name TEXT NOT NULL,
  email CITEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS residents_unit_status_idx
  ON residents (unit_id, status);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  resident_id UUID NOT NULL REFERENCES residents (id),
  billing_period DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'partially_paid', 'paid', 'void')),
  total_minor BIGINT NOT NULL CHECK (total_minor >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (resident_id, billing_period)
);

CREATE INDEX IF NOT EXISTS invoices_resident_due_idx
  ON invoices (resident_id, status, due_date);

CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('maintenance', 'water', 'sinking_fund', 'previous_dues', 'fees')),
  description TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0)
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx
  ON invoice_items (invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices (id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'reconciled')),
  reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_invoice_status_idx
  ON payments (invoice_id, status, created_at DESC);

ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'archived'));

CREATE TABLE IF NOT EXISTS notice_reads (
  resident_id UUID NOT NULL REFERENCES residents (id) ON DELETE CASCADE,
  notice_id UUID NOT NULL REFERENCES notices (id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resident_id, notice_id)
);

CREATE INDEX IF NOT EXISTS notices_published_idx
  ON notices (tenant_id, status, published_at DESC);
