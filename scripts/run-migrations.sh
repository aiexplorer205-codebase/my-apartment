#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

usage() {
  cat <<'USAGE'
Usage:
  scripts/run-migrations.sh platform DATABASE MIGRATION.sql [MIGRATION.sql ...]
  scripts/run-migrations.sh tenant DATABASE MIGRATION.sql [MIGRATION.sql ...]
  scripts/run-migrations.sh tenant all-tenants MIGRATION.sql [MIGRATION.sql ...]

Examples:
  scripts/run-migrations.sh platform platform_db 009_per_block_flat_allowances.sql
  scripts/run-migrations.sh tenant all-tenants 014_polls.sql
  scripts/run-migrations.sh tenant tenant_local 014_polls.sql
USAGE
}

if (($# < 3)); then
  usage >&2
  exit 2
fi

kind=$1
target=$2
shift 2

case "$kind" in
  platform|tenant) ;;
  *) echo "Migration group must be 'platform' or 'tenant'." >&2; usage >&2; exit 2 ;;
esac
migration_dir="${kind}_db"

if [[ "$target" != all-tenants && ! "$target" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$ ]]; then
  echo "Database name contains unsupported characters." >&2
  exit 2
fi

for migration in "$@"; do
  if [[ ! "$migration" =~ ^[0-9]{3}_[a-z0-9_]+\.sql$ || ! -f "migrations/$migration_dir/$migration" ]]; then
    echo "Unknown $kind migration: $migration" >&2
    exit 2
  fi
done

migrations=("$@")

apply_migrations() {
  local database=$1 migration
  echo "Applying ${kind} migrations to ${database}"
  for migration in "${migrations[@]}"; do
    docker compose exec -T postgres psql -U postgres -d "$database" \
      -v ON_ERROR_STOP=1 -f "/migrations/$migration_dir/$migration"
  done
}

if [[ "$kind" == tenant && "$target" == all-tenants ]]; then
  apply_migrations tenant_template
  while IFS= read -r database; do
    [[ -n "$database" ]] && apply_migrations "$database"
  done < <(docker compose exec -T postgres psql -U postgres -d platform_db -At \
    -v ON_ERROR_STOP=1 -c "SELECT database_name FROM tenant_records WHERE database_name IS NOT NULL ORDER BY database_name")
else
  if [[ "$target" == all-tenants ]]; then
    echo "The all-tenants target is only valid for tenant migrations." >&2
    exit 2
  fi
  apply_migrations "$target"
fi
