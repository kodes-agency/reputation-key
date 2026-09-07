#!/bin/sh
set -eu

attempt=0
while [ "$attempt" -lt 60 ]; do
  if docker compose -f compose.local.yml --env-file e2e/stack.env logs worker 2>&1 | grep -q "BullMQ worker started on default queue"; then
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo "Timed out waiting for the BullMQ worker" >&2
docker compose -f compose.local.yml --env-file e2e/stack.env logs worker >&2
exit 1
