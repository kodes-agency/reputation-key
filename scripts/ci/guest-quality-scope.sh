#!/usr/bin/env bash
# Prints `true` when the guest quality checks must run for this event, else `false`.
# Pull requests and pushes run them only when a changed path is a guest path; a
# manual run, or a diff that cannot be computed, always runs them.
set -euo pipefail

is_guest_path() {
  case "$1" in
    .github/workflows/ci.yml | scripts/ci/guest-quality-scope.sh) return 0 ;;
    .storybook/* | src/components/features/guest/* | src/components/features/portal/*) return 0 ;;
    src/components/ui/* | src/components/hooks/* | src/components/forms/*) return 0 ;;
    src/contexts/guest/* | src/contexts/portal/* | src/routes/p/* | src/routes/api/public/*) return 0 ;;
    src/shared/* | src/lib/* | *.css | public/*) return 0 ;;
    e2e/storybook-metrics/* | e2e/helpers/*) return 0 ;;
    scripts/e2e/guest-quality.sh | scripts/ci/install-playwright-deps.sh) return 0 ;;
    playwright.storybook.config.ts | vite.config.ts | vitest.config.ts) return 0 ;;
    package.json | pnpm-lock.yaml | .nvmrc) return 0 ;;
    tsconfig*.json) [[ "$1" != */* ]] && return 0 ;;
  esac
  return 1
}

sha="${GITHUB_SHA:?Commit SHA is required}"
case "${GITHUB_EVENT_NAME:-}" in
  pull_request)
    base="${PR_BASE_SHA:-}"
    head="${PR_HEAD_SHA:-}"
    ;;
  push)
    base="${PUSH_BEFORE:-}"
    head="$sha"
    ;;
  *)
    echo true
    exit 0
    ;;
esac

if [[ -z "$base" || -z "$head" || "$base" =~ ^0+$ ]] ||
  ! git cat-file -e "${base}^{commit}" 2>/dev/null ||
  ! git cat-file -e "${head}^{commit}" 2>/dev/null; then
  echo true
  exit 0
fi

# Three dots diff from the merge base, so a stale branch is not credited with
# main's newer changes.
if ! files="$(git diff --name-only "${base}...${head}" 2>/dev/null)"; then
  echo true
  exit 0
fi

while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  if is_guest_path "$file"; then
    echo true
    exit 0
  fi
done <<<"$files"
echo false
