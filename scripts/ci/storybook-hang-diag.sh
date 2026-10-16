#!/usr/bin/env bash
# Temporary: runs the storybook project repeatedly under the watchdog reporter
# to catch the intermittent portal-editor hang on a CI runner.
# usage: storybook-hang-diag.sh <mode: full|copies> <iterations> <limit-seconds>
set -u
mode=$1; iterations=$2; limit=$3
D=src/components/features/portal/portal-editor
if [ "$mode" = copies ]; then
  for i in $(seq -w 1 12); do
    f=$D/portal-editor-stress-$i.stories.tsx
    cp $D/portal-editor.stories.tsx $f
    perl -0pi -e "s/title: 'Portal\/PortalEditor',/title: 'Portal\/PortalEditorStress$i',/" $f
  done
  target=$D/
else
  target=
fi
for i in $(seq 1 "$iterations"); do
  echo "::group::iteration $i ($mode)"
  CDP_PORT=9222 STALL_MS=60000 TRACE_FILE=trace-$i.txt REPKEY_STORYBOOK_TESTS=true \
    timeout -s KILL "$limit" pnpm exec vitest run --project=storybook \
    --reporter=./scripts/ci/storybook-watchdog-reporter.mjs --reporter=dot $target
  rc=$?
  echo "::endgroup::"
  echo "iteration $i exit $rc"
  if [ $rc -eq 137 ]; then
    echo "::error::iteration $i hung and was killed after ${limit}s"
    pkill -9 -f chrome || true
  fi
done
echo "=== watchdog reports ==="
grep -h -A120 WATCHDOG trace-*.txt || echo "no stall seen"
