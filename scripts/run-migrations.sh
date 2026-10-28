#!/usr/bin/env bash
set -euo pipefail
# Migrate one shared database, never enumerate or connect to customer databases.
# With no filenames, apply all pending migrations; checksums prevent edited history.
kind=${1:?Usage: scripts/run-migrations.sh platform|tenant [MIGRATION.sql ...]}
shift
case "$kind" in
  platform) database=myapartment_platform_db; migration_url=${PLATFORM_MIGRATION_URL:-} ;;
  tenant) database=myapartment_app_db; migration_url=${TENANT_MIGRATION_URL:-} ;;
  *) echo 'Choose platform or tenant' >&2; exit 2 ;;
esac
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
if [[ -n "$migration_url" ]]; then
  MIGRATIONS_ROOT="$repo_root/migrations" MIGRATION_DATABASE_URL="$migration_url" \
    bash "$repo_root/scripts/migrate-database.sh" "$kind" "$database" "$@"
else
  docker compose exec -T postgres bash /scripts/migrate-database.sh "$kind" "$database" "$@"
fi
