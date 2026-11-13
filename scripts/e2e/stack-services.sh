#!/bin/sh
# Backing services for both local stacks: certs, the Compose services
# (Postgres, Redis, the TLS Google sandbox, the AI stub, the mail stub, the object store), the
# deploy migration and the e2e seed. `e2e:stack:up` then starts the
# containerised production build on top; `dev` starts the host web and
# worker instead (scripts/local/host-stack.ts).
set -eu
set -a
. ./e2e/stack.env
set +a
scripts/e2e/gen-certs.sh
# CI builds the images once for the whole run, loads them under the names this
# Compose file gives them and sets E2E_STACK_PREBUILT=1: the stack then runs
# those bytes, and a missing image fails here instead of being rebuilt.
build=--build
[ "${E2E_STACK_PREBUILT:-}" = 1 ] && build=--no-build
docker compose -f compose.local.yml --env-file e2e/stack.env up -d "$build" --wait \
  postgres redis provider-sandbox ai-provider-stub mail-stub object-store
REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS="$MIGRATOR_REVIEW_PROVIDER_SUBJECT_HMAC_KEYS" \
  DEPLOY_MIGRATE=1 pnpm db:migrate-deploy
LOCAL_TOOL_EXECUTION_IDENTITY="$HOST_LOCAL_TOOL_EXECUTION_IDENTITY" pnpm seed:e2e-user
