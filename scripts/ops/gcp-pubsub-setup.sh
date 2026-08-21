#!/usr/bin/env bash
#
# Provision the Google Cloud side of GBP push notifications.
#
# Idempotent: every step checks for the existing resource first, so re-running
# after a partial failure is safe and re-running on a finished project is a
# no-op. Read-only by default — pass --apply to make changes, mirroring the
# convention of the TypeScript ops scripts in this directory.
#
# What it does NOT do: set the app's environment variables (they live in
# Railway, and the values are printed at the end for you to paste), and
# subscribe the tenants (that is `pnpm ops:gbp-subscribe`, which needs the
# app's database). See docs/operations/google-pubsub-setup.md.
#
# Usage:
#   scripts/ops/gcp-pubsub-setup.sh --project PROJECT_ID --domain YOUR_DOMAIN
#   scripts/ops/gcp-pubsub-setup.sh --project PROJECT_ID --domain YOUR_DOMAIN --apply
#
set -euo pipefail

TOPIC="gbp-notifications"
SUBSCRIPTION="gbp-notifications-push"
PUSH_SA_NAME="gbp-push-caller"
# Google's own publisher identity. Identical in every project — you are granting
# Google permission to write into your topic, not creating an account.
GOOGLE_PUBLISHER="mybusiness-api-pubsub@system.gserviceaccount.com"
# Opaque audience string, compared byte-for-byte against GBP_PUBSUB_AUDIENCE.
# It is never fetched, so it does not have to be your deployment's domain.
AUDIENCE="https://reputationkey.app/webhooks/gbp"
WEBHOOK_PATH="/api/webhooks/gbp/notifications"

PROJECT=""
DOMAIN=""
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="${2:?--project needs a value}"; shift 2 ;;
    --domain)  DOMAIN="${2:?--domain needs a value}";   shift 2 ;;
    --apply)   APPLY=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$PROJECT" ] || { echo "error: --project PROJECT_ID is required" >&2; exit 2; }
[ -n "$DOMAIN" ]  || { echo "error: --domain YOUR_DOMAIN is required (no scheme)" >&2; exit 2; }

DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
ENDPOINT="https://${DOMAIN}${WEBHOOK_PATH}"

command -v gcloud >/dev/null || { echo "error: gcloud not on PATH" >&2; exit 1; }
gcloud auth print-access-token >/dev/null 2>&1 || {
  echo "error: gcloud is not authenticated. Run: gcloud auth login" >&2; exit 1; }

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
PUSH_SA="${PUSH_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
PUBSUB_AGENT="service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

if [ "$APPLY" -eq 0 ]; then
  echo "DRY RUN — nothing will be changed. Re-run with --apply to execute."
fi
echo
echo "project        $PROJECT ($PROJECT_NUMBER)"
echo "topic          $TOPIC"
echo "subscription   $SUBSCRIPTION"
echo "push endpoint  $ENDPOINT"
echo "push identity  $PUSH_SA"
echo "audience       $AUDIENCE"
echo

# `run` prints the action, then executes it only under --apply. Every caller is
# preceded by an existence check, so a printed action is always a real change.
run() {
  echo "  → $*"
  if [ "$APPLY" -eq 1 ]; then "$@"; fi
}

echo "[1/5] APIs"
for api in pubsub.googleapis.com mybusinessnotifications.googleapis.com; do
  if gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' \
      2>/dev/null | grep -qx "$api"; then
    echo "  ✓ $api already enabled"
  else
    run gcloud services enable "$api" --project="$PROJECT"
  fi
done

echo "[2/5] Topic"
if gcloud pubsub topics describe "$TOPIC" --project="$PROJECT" >/dev/null 2>&1; then
  echo "  ✓ topic $TOPIC exists"
else
  run gcloud pubsub topics create "$TOPIC" --project="$PROJECT"
fi

echo "[3/5] Publisher grant for Google"
# The step whose absence is silent: without it Google accepts the subscribe call
# and then drops every publish, so the symptom is "no notifications" with no error.
if gcloud pubsub topics get-iam-policy "$TOPIC" --project="$PROJECT" \
    --format=json 2>/dev/null \
    | grep -q "$GOOGLE_PUBLISHER"; then
  echo "  ✓ $GOOGLE_PUBLISHER already bound"
else
  run gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
    --member="serviceAccount:${GOOGLE_PUBLISHER}" \
    --role="roles/pubsub.publisher" --project="$PROJECT"
fi

echo "[4/5] Push identity"
if gcloud iam service-accounts describe "$PUSH_SA" --project="$PROJECT" >/dev/null 2>&1; then
  echo "  ✓ $PUSH_SA exists"
else
  # Deliberately no project roles: this account exists only to be the `email`
  # claim in the OIDC token the webhook pins.
  run gcloud iam service-accounts create "$PUSH_SA_NAME" \
    --display-name="GBP Pub/Sub push caller" --project="$PROJECT"
fi

# Projects created after 2021-04-08 get this via roles/pubsub.serviceAgent.
# Binding it when it is already implied is harmless, so we bind unconditionally
# rather than trying to date the project.
if gcloud iam service-accounts get-iam-policy "$PUSH_SA" --project="$PROJECT" \
    --format=json 2>/dev/null | grep -q "$PUBSUB_AGENT"; then
  echo "  ✓ pubsub service agent may already mint tokens for it"
else
  run gcloud iam service-accounts add-iam-policy-binding "$PUSH_SA" \
    --member="serviceAccount:${PUBSUB_AGENT}" \
    --role="roles/iam.serviceAccountTokenCreator" --project="$PROJECT"
fi

echo "[5/5] Push subscription"
if gcloud pubsub subscriptions describe "$SUBSCRIPTION" --project="$PROJECT" >/dev/null 2>&1; then
  echo "  ✓ subscription $SUBSCRIPTION exists — verifying its endpoint and audience"
  run gcloud pubsub subscriptions update "$SUBSCRIPTION" \
    --push-endpoint="$ENDPOINT" \
    --push-auth-service-account="$PUSH_SA" \
    --push-auth-token-audience="$AUDIENCE" \
    --project="$PROJECT"
else
  run gcloud pubsub subscriptions create "$SUBSCRIPTION" \
    --topic="$TOPIC" \
    --push-endpoint="$ENDPOINT" \
    --push-auth-service-account="$PUSH_SA" \
    --push-auth-token-audience="$AUDIENCE" \
    --ack-deadline=30 \
    --min-retry-delay=10s \
    --max-retry-delay=600s \
    --project="$PROJECT"
fi

cat <<EOF

────────────────────────────────────────────────────────────────
Set these on BOTH the web and worker services:

  GBP_PUBSUB_TOPIC=projects/${PROJECT}/topics/${TOPIC}
  GBP_PUBSUB_AUDIENCE=${AUDIENCE}
  GBP_PUBSUB_PUSH_SERVICE_ACCOUNT=${PUSH_SA}
  GBP_PUBSUB_NOTIFICATION_TYPES=NEW_REVIEW

Then subscribe each tenant (org-scoped, dry-run first):

  pnpm ops:gbp-subscribe --operator <user-id> --org <org-id>
  pnpm ops:gbp-subscribe --operator <user-id> --org <org-id> --reason "enable GBP push" --apply

Verify: GET /api/health/metrics → sync.gbp_push_enabled == 1, then post a
review on a connected property and watch for a sync job with initiator
webhook:gbp. Full runbook: docs/operations/google-pubsub-setup.md
EOF

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "DRY RUN — nothing was changed. Re-run with --apply."
fi
