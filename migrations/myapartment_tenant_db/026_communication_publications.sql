SET search_path TO block9_tenant, public;
CREATE TABLE communication_publications (
  tenant_id TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  request_key UUID NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('announcement','poll')),
  payload_hash TEXT NOT NULL,
  record_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(tenant_id,actor_subject,request_key)
);
