#!/usr/bin/env bash
set -euo pipefail
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"
compose=(docker compose -p myapartment-schema-check -f docker/compose.test.yaml)
"${compose[@]}" up -d --wait
# S3Mock has no container healthcheck; wait for its HTTP API without sleeping
# inside application tests. curl retries are bounded and this is test-only.
curl --silent --fail --retry 30 --retry-connrefused --retry-delay 1 http://127.0.0.1:59000/ > /dev/null || true
trap '"${compose[@]}" down --volumes' EXIT
MYAPARTMENT_DATABASE_TESTS=1 pnpm test "$@"
