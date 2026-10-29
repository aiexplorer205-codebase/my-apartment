#!/usr/bin/env bash
# Run from the Compose host with age and rclone installed. Configure rclone via
# workload credentials or protected environment, never put credentials in args.
set -euo pipefail
umask 077
: "${BACKUP_AGE_RECIPIENT:?Set the age public recipient; keep the private recovery key offline}"
: "${BACKUP_REMOTE:?Set a private rclone remote:path, e.g. recovery:backups}"
command -v age >/dev/null
command -v rclone >/dev/null
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
for database in myapartment_platform_db myapartment_app_db; do
  docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -Fc "$1"' sh "$database" \
    | age -r "$BACKUP_AGE_RECIPIENT" > "$work/$database.dump.age"
done
# Role passwords are recovered from the secret manager, not exported in this file.
docker compose exec -T postgres sh -c 'exec pg_dumpall -U "$POSTGRES_USER" --roles-only --no-role-passwords' \
  | age -r "$BACKUP_AGE_RECIPIENT" > "$work/roles.sql.age"
(cd "$work" && sha256sum ./*.age > SHA256SUMS)
archive="$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$work").tar"
tar -C "$work" -cf - . | rclone rcat "${BACKUP_REMOTE%/}/$archive"
printf 'database backup completed\n'
