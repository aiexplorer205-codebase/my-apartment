#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname myapartment_app_db \
  -v app_password="$APP_DATABASE_PASSWORD" -v lifecycle_password="$LIFECYCLE_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE myapartment_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';
GRANT myapartment_runtime TO myapartment_app;
CREATE ROLE myapartment_operator_lifecycle LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'lifecycle_password';
GRANT myapartment_lifecycle TO myapartment_operator_lifecycle;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE myapartment_app_db FROM PUBLIC;
GRANT CONNECT ON DATABASE myapartment_app_db TO myapartment_app, myapartment_operator_lifecycle;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname myapartment_platform_db \
  -v platform_password="$PLATFORM_DATABASE_PASSWORD" <<'SQL'
CREATE ROLE myapartment_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'platform_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA block9_platform TO myapartment_platform;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA block9_platform TO myapartment_platform;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA block9_platform TO myapartment_platform;
REVOKE UPDATE,DELETE,TRUNCATE ON block9_platform.platform_audit FROM myapartment_platform;
SQL
