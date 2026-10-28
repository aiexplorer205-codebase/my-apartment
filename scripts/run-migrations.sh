#!/usr/bin/env bash
set -euo pipefail
# Migrate one shared database, never enumerate or connect to customer databases.
# With no filenames, apply all pending migrations; checksums prevent edited history.
kind=${1:?Usage: scripts/run-migrations.sh platform|tenant [MIGRATION.sql ...]}
shift
case "$kind" in
  platform) database=myapartment_platform_db ;;
  tenant) database=myapartment_app_db ;;
  *) echo 'Choose platform or tenant' >&2; exit 2 ;;
esac
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
docker compose exec -T postgres bash /scripts/migrate-database.sh "$kind" "$database" "$@"
