SET search_path TO block9_tenant, public;

-- The API's idempotent enqueue uses ON CONFLICT, which also requires SELECT.
GRANT SELECT,INSERT ON push_outbox TO myapartment_runtime;
