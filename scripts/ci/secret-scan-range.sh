#!/usr/bin/env bash
# Prints the git log range the `secrets` job hands to gitleaks.
set -euo pipefail

if [[ "${GITHUB_EVENT_NAME:-}" == pull_request ]]; then
  : "${PR_BASE_SHA:?PR base SHA is required}"
  : "${PR_HEAD_SHA:?PR head SHA is required}"
  printf '%s..%s\n' "$PR_BASE_SHA" "$PR_HEAD_SHA"
  exit 0
fi

sha="${GITHUB_SHA:?Commit SHA is required}"
before="${PUSH_BEFORE:-}"
# A new branch, a manual run or a rewritten history has no usable `before`;
# scanning the one commit also covers a root commit.
if [[ -n "$before" && ! "$before" =~ ^0+$ ]] && git cat-file -e "${before}^{commit}" 2>/dev/null; then
  printf '%s..%s\n' "$before" "$sha"
else
  printf '%s\n' "--max-count=1 $sha"
fi
