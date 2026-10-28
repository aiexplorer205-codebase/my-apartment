SET search_path TO block9_platform, public;
CREATE TABLE resident_session_revocations (
  subject TEXT PRIMARY KEY,
  revoked_before TIMESTAMPTZ NOT NULL
);
