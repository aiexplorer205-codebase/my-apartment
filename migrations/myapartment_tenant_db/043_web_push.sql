SET search_path TO block9_tenant, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_push_dispatcher') THEN
    CREATE ROLE myapartment_push_dispatcher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='myapartment_push_dispatcher'
    AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Push dispatcher role must be restricted and NOLOGIN';
  END IF;
END $$;

CREATE TABLE push_preferences (
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL,
  auth_subject TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','te')),
  notices_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  polls_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  complaints_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reset_email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  email TEXT,
  last_reset_email_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id,resident_id),
  UNIQUE (tenant_id,auth_subject),
  FOREIGN KEY (tenant_id,resident_id) REFERENCES residents(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  resident_id UUID NOT NULL,
  auth_subject TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id,resident_id) REFERENCES residents(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,auth_subject) REFERENCES push_preferences(tenant_id,auth_subject) ON DELETE CASCADE
);
CREATE INDEX push_subscriptions_resident_idx ON push_subscriptions(tenant_id,resident_id);
CREATE INDEX push_subscriptions_subject_idx ON push_subscriptions(tenant_id,auth_subject);

CREATE TABLE push_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL REFERENCES organizations(tenant_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('notice','poll','complaint-status-change')),
  event_id UUID NOT NULL,
  target_resident_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at TIMESTAMPTZ,
  targets_materialized_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (tenant_id,event_type,event_id),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,target_resident_id) REFERENCES residents(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX push_outbox_dispatch_idx ON push_outbox(next_attempt_at,created_at)
  WHERE completed_at IS NULL;

CREATE TABLE push_outbox_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  outbox_id UUID NOT NULL REFERENCES push_outbox(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT,
  UNIQUE (outbox_id,subscription_id),
  FOREIGN KEY (tenant_id,outbox_id) REFERENCES push_outbox(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX push_outbox_deliveries_dispatch_idx ON push_outbox_deliveries(next_attempt_at)
  WHERE completed_at IS NULL;

ALTER TABLE push_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_preferences TO myapartment_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
CREATE POLICY push_dispatch_tenant_isolation ON push_preferences TO myapartment_push_dispatcher
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''));

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_subscriptions TO myapartment_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
-- The dedicated dispatcher can see the globally-unique endpoint index across
-- tenants only to reassign an endpoint after an authenticated resident registers.
CREATE POLICY push_dispatch_endpoint_reassignment ON push_subscriptions TO myapartment_push_dispatcher
  USING (true) WITH CHECK (true);

ALTER TABLE push_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_outbox TO myapartment_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
CREATE POLICY push_dispatch_tenant_isolation ON push_outbox TO myapartment_push_dispatcher
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''));

ALTER TABLE push_outbox_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_outbox_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON push_outbox_deliveries TO myapartment_runtime
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
CREATE POLICY push_dispatch_tenant_isolation ON push_outbox_deliveries TO myapartment_push_dispatcher
  USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
  WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));

GRANT SELECT,INSERT,UPDATE,DELETE ON push_preferences,push_subscriptions TO myapartment_runtime;
GRANT INSERT ON push_outbox TO myapartment_runtime;
GRANT SELECT,UPDATE ON push_outbox TO myapartment_push_dispatcher;
GRANT SELECT,INSERT,UPDATE ON push_outbox_deliveries TO myapartment_push_dispatcher;
GRANT SELECT ON push_preferences TO myapartment_push_dispatcher;
GRANT SELECT,INSERT,UPDATE,DELETE ON push_subscriptions TO myapartment_push_dispatcher;
GRANT USAGE ON SCHEMA block9_tenant TO myapartment_push_dispatcher;
