#!/bin/sh
# The guest page's quality gate (round 4, slice 18): geometry, reduced motion,
# LCP and CLS, against two builds of Storybook served by this run's own static
# server (no dev server, no port 3000).
#
#   pnpm test:guest:quality
#
# Two builds, because the two halves need different things:
#
#   - Geometry and reduced motion run the stories' `play` functions, which read
#     the DOM straight after the render. React's `act` exists only in a
#     development build; in a production one the render is not flushed when the
#     play starts and the first `getByRole` finds an empty root. So that half
#     runs on a development-flavoured build (NODE_ENV=development), which is
#     what the Vitest story runner renders too.
#   - LCP and CLS must come from the production bundle: a development bundle's
#     numbers are React's warnings and unminified code. That half runs on the
#     ordinary production build.
#
# STORYBOOK_METRICS_PORT moves the server when 6106 is taken. The development
# build lives under test-results/, which is git-ignored, in a directory named
# storybook-static, which ESLint and Prettier already skip.
set -eu
cd "$(dirname "$0")/../.."

production=storybook-static
development=test-results/storybook-metrics/storybook-static
export STORYBOOK_METRICS_PORT="${STORYBOOK_METRICS_PORT:-6106}"

pnpm exec storybook build --quiet -o "$production"
NODE_ENV=development pnpm exec storybook build --quiet -o "$development"

# Both halves run even when the first is red: a gate that stops at its first
# failure hides the second one's.
status=0
STORYBOOK_METRICS_STATIC="$development" \
  pnpm exec playwright test --config=playwright.storybook.config.ts guest-immersive || status=1
STORYBOOK_METRICS_STATIC="$production" \
  pnpm exec playwright test --config=playwright.storybook.config.ts guest-vitals || status=1
exit "$status"
