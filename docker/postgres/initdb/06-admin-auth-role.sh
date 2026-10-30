#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname myapartment_platform_db \
  -v auth_password="$ADMIN_AUTH_DATABASE_PASSWORD" -f /scripts/provision-admin-auth.sql
