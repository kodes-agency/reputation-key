#!/usr/bin/env bash
# Deep review watchdog — checks if the sequential review loop is stalled.
# Returns nothing (silent) if work is flowing or complete.
# Outputs alert message if stalled for >20 min.

set -euo pipefail

PROGRESS_FILE=".hermes/deep-review-progress.json"

if [[ ! -f "$PROGRESS_FILE" ]]; then
  echo "⚠️ Deep review progress file not found. The review loop may not have started."
  exit 0
fi

STATUS=$(python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta

with open('$PROGRESS_FILE') as f:
    data = json.load(f)

status = data.get('status', 'unknown')
last_update = data.get('lastUpdate', '')
current = data.get('currentReview', '?')
completed = data.get('completedReviews', [])
total = data.get('totalReviews', 17)

if status == 'completed':
    # All done — signal to remove cron
    print(f'DONE:{len(completed)}/{total}')
    sys.exit(0)

if not last_update:
    print(f'STALLED:{current}:no_timestamp')
    sys.exit(0)

try:
    lu = datetime.fromisoformat(last_update.replace('Z', '+00:00'))
except:
    print(f'STALLED:{current}:bad_timestamp')
    sys.exit(0)

now = datetime.now(timezone.utc)
stale_minutes = (now - lu).total_seconds() / 60

if stale_minutes > 20:
    print(f'STALLED:{current}:{int(stale_minutes)}min_stale:{len(completed)}_done')
else:
    # Work is flowing — silent
    sys.exit(0)
")
EXIT_CODE=$?

if [[ -z "$STATUS" ]]; then
  # Silent — work is flowing
  exit 0
fi

if [[ "$STATUS" == DONE:* ]]; then
  echo "✅ Deep review complete: ${STATUS#DONE:} reviews done. This watchdog can be removed."
  exit 0
fi

if [[ "$STATUS" == STALLED:* ]]; then
  PARTS="${STATUS#STALLED:}"
  CURRENT=$(echo "$PARTS" | cut -d: -f1)
  DETAIL=$(echo "$PARTS" | cut -d: -f2-)
  echo "⚠️ Deep review loop appears stalled at review ${CURRENT} (${DETAIL})."
  echo ""
  echo "The agent may have crashed due to an API error or interruption."
  echo "Action needed: Resume the deep review loop from review ${CURRENT}."
  echo "Check .hermes/deep-review-progress.json for details."
  exit 0
fi
