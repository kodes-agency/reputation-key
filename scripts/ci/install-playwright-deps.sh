#!/bin/sh
# Installs the system packages Playwright's browsers need (`playwright
# install-deps`) under deadlines, so a stalled Ubuntu mirror costs minutes and
# names itself instead of holding the job until its timeout-minutes.
#
# WHY. GitHub's Ubuntu runners fetch packages through a mirror list,
# /etc/apt/apt-mirrors.txt, whose preferred entry is Azure's own mirror. On
# 2026-10-22 from about 12:50 UTC that mirror served the ~115 MB this step
# needs at ~110 kB/s instead of ~14 MB/s: a step that takes ~30 s took 17-25
# minutes, and 12 e2e shards hit their 25-minute timeout, two of them
# inside later steps that were not at fault. apt does not leave a mirror that
# trickles, because its timeout fires only when nothing arrives at all. One
# runner moved on to archive.ubuntu.com after 17 minutes and fetched the rest
# in 10 s; others never moved on. See docs/operations/e2e-flake-register.md.
#
# HOW. Two phases, each run as root so that `timeout` can stop apt too (run as
# the runner user, Playwright starts apt through its own sudo, out of reach).
#   1. Download only (APT::Get::Download-Only). Stopping apt mid-download
#      leaves nothing half-installed, so when the deadline passes, the mirror
#      apt prefers is dropped from the list for the rest of this job and the
#      download runs once more. Packages that already arrived stay in
#      /var/cache/apt/archives.
#   2. Install what was downloaded, so no package download is left to stall.
# A missed deadline fails the step with a message naming the phase and mirror.
#
# Usage: sh scripts/ci/install-playwright-deps.sh chromium [firefox webkit]
set -eu

DOWNLOAD_SECONDS="${PLAYWRIGHT_DEPS_DOWNLOAD_SECONDS:-120}"
INSTALL_SECONDS="${PLAYWRIGHT_DEPS_INSTALL_SECONDS:-180}"
MIRROR_LIST=/etc/apt/apt-mirrors.txt
DOWNLOAD_ONLY=/etc/apt/apt.conf.d/90playwright-download-only
PLAYWRIGHT="$PWD/node_modules/.bin/playwright"

fail() {
  echo "::error title=Playwright system packages::$1"
  exit 1
}

# `timeout` exits 124 when its TERM stopped the command, 137 when it had to KILL.
timed_out() {
  [ "$1" -eq 124 ] || [ "$1" -eq 137 ]
}

install_deps() {
  seconds="$1"
  shift
  sudo timeout --kill-after=15 "$seconds" env "PATH=$PATH" "$PLAYWRIGHT" install-deps "$@"
}

# The mirror apt tries first in the list on stdin: the lowest `priority:`,
# else the earliest line.
preferred_mirror() {
  awk '
    /^[ \t]*(#|$)/ { next }
    {
      rank = 1000000 + NR
      if (match($0, /priority:[0-9]+/)) rank = substr($0, RSTART + 9, RLENGTH - 9) + 0
      if (best == "" || rank < best_rank) { best = $1; best_rank = rank }
    }
    END { print best }
  '
}

# The mirror list without the lines naming $1.
other_mirrors() {
  grep -v -F "$1" "$MIRROR_LIST" || true
}

trap 'sudo rm -f "$DOWNLOAD_ONLY"' EXIT
echo 'APT::Get::Download-Only "true";' | sudo tee "$DOWNLOAD_ONLY" >/dev/null

status=0
install_deps "$DOWNLOAD_SECONDS" "$@" || status=$?
if timed_out "$status"; then
  [ -r "$MIRROR_LIST" ] ||
    fail "Downloading packages took over ${DOWNLOAD_SECONDS}s and there is no $MIRROR_LIST to fall back on."
  stalled=$(preferred_mirror <"$MIRROR_LIST")
  next=$(other_mirrors "$stalled" | preferred_mirror)
  [ -n "$next" ] ||
    fail "Downloading packages from $stalled took over ${DOWNLOAD_SECONDS}s and $MIRROR_LIST names no other mirror."
  other_mirrors "$stalled" | sudo tee "$MIRROR_LIST" >/dev/null
  echo "::warning title=Slow Ubuntu mirror::Downloading packages from $stalled took over ${DOWNLOAD_SECONDS}s; this job now uses $next."
  status=0
  install_deps "$DOWNLOAD_SECONDS" "$@" || status=$?
  if timed_out "$status"; then
    fail "Downloading packages took over ${DOWNLOAD_SECONDS}s from $stalled and again from $next. Ubuntu's mirrors are stalling; re-run the job later."
  fi
fi
[ "$status" -eq 0 ] || exit "$status"

sudo rm -f "$DOWNLOAD_ONLY"
status=0
install_deps "$INSTALL_SECONDS" "$@" || status=$?
if timed_out "$status"; then
  fail "Installing the downloaded packages took over ${INSTALL_SECONDS}s. The download had finished, so apt-get update or dpkg is stuck, not a package download."
fi
exit "$status"
