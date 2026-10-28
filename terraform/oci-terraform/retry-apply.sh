#!/usr/bin/env bash
# Ampere A1 capacity is often exhausted ("Out of host capacity").
# This re-runs terraform apply every 60 s until it succeeds. Safe to re-run: apply is idempotent.
set -u
i=0
while true; do
  i=$((i + 1))
  echo "=== Attempt $i at $(date) ==="
  if out=$(terraform apply -auto-approve -input=false 2>&1); then
    echo "$out"
    echo "SUCCESS"
    exit 0
  fi
  echo "$out" | tail -n 15
  if echo "$out" | grep -qi "out of host capacity"; then
    echo "No A1 capacity right now. Retrying in 60 s (Ctrl+C to stop)."
    sleep 60
  else
    echo "Different error. Fix it, then re-run. Stopping."
    exit 1
  fi
done
