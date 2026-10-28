#!/usr/bin/env bash
# Run inside the Postgres container (or with psql and PG* configured).
set -euo pipefail
kind=${1:?platform or tenant required}
database=${2:?database required}
shift 2
[[ "$kind" == platform || "$kind" == tenant ]] || exit 2
[[ "$database" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || exit 2
migration_root=${MIGRATIONS_ROOT:-/migrations}
if (($# == 0)); then
  files=("$migration_root/myapartment_${kind}_db/"*.sql)
else
  files=()
  for name in "$@"; do
    [[ "$name" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ ]] || exit 2
    files+=("$migration_root/myapartment_${kind}_db/$name")
  done
fi
# psql holds the session lock across every file, including transaction commits.
{
  cat <<'SQL'
\set ON_ERROR_STOP on
SELECT pg_advisory_lock(9049000);
CREATE SCHEMA IF NOT EXISTS block9_migrations;
CREATE TABLE IF NOT EXISTS block9_migrations.applied (
  name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL
  for file in "${files[@]}"; do
    [[ -f "$file" ]] || exit 2
    name=${file##*/}
    checksum=$(sha256sum "$file" | cut -d ' ' -f 1)
    printf "SELECT EXISTS(SELECT 1 FROM block9_migrations.applied WHERE name='%s') AS applied \\gset\n" "$name"
    printf '\\if :applied\n'
    printf "DO \$\$ BEGIN IF NOT EXISTS(SELECT 1 FROM block9_migrations.applied WHERE name='%s' AND checksum='%s') THEN RAISE EXCEPTION 'Migration checksum mismatch: %s'; END IF; END \$\$;\n" "$name" "$checksum" "$name"
    printf '\\else\nBEGIN;\n\\i %s\n' "$file"
    printf "INSERT INTO block9_migrations.applied(name,checksum) VALUES('%s','%s');\nCOMMIT;\n" "$name" "$checksum"
    printf '\\endif\n'
  done
  printf 'SELECT pg_advisory_unlock(9049000);\n'
} | psql -X --username "${POSTGRES_USER:-postgres}" --dbname "$database"
