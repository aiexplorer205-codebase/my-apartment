#!/usr/bin/env bash
# Run from the repo root with AWS CLI instance-role credentials (no static keys).
# Daily maintenance window: halt app writes for a consistent multi-database dump.
set -euo pipefail
umask 077
if [[ $# != 1 || ! "$1" =~ ^s3://[a-z0-9][a-z0-9.-]+/[a-zA-Z0-9/_-]+$ ]]; then
  echo 'Usage: bash scripts/backup-production.sh s3://BUCKET/PREFIX' >&2
  exit 2
fi
node scripts/validate-production.mjs .env.production
command -v aws >/dev/null
compose=(docker compose --env-file .env.production -f compose.yaml -f compose.production.yaml)
# Do not restart an incomplete deployment or deliberately stopped services.
for service in api login-web resident-web admin-web operator-web; do
  container_id=$("${compose[@]}" ps -q --status running "$service")
  if [[ -z "$container_id" ]]; then echo 'All app services must be running before a scheduled backup.' >&2; exit 1; fi
done
restart_apps() { "${compose[@]}" start --wait api login-web resident-web admin-web operator-web; }
trap restart_apps EXIT
"${compose[@]}" stop -t 60 api login-web resident-web admin-web operator-web
# Includes roles, platform, template, tenants and their photos. No plaintext disk dump.
# Upload errors propagate through pipefail. A success line means the upload finished.
object="$1/$(date -u +%Y-%m-%dT%H-%M-%SZ).sql.gz"
"${compose[@]}" exec -T postgres pg_dumpall -U postgres | gzip | aws s3 cp - "$object" --sse AES256 --only-show-errors
echo "Backup uploaded: $object"
