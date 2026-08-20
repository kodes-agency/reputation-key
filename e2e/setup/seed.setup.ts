// The suite's one hard external precondition, declared in the config instead of
// implied by every spec's import list.
//
// Both real projects declare `dependencies: ['setup']`, so a single-file
// invocation carries its own precondition instead of inheriting it from
// whatever ran before.
//
// WHAT THIS DOES NOT DO, measured rather than assumed: it does not replace the
// load-time throw. Every critical spec resolves the seeded ids at MODULE LOAD
// (`const seed = requireE2eSeedState()`), and Playwright COLLECTS every matched
// spec file before executing any project — dependencies included. Moving
// e2e/.seed-state.json aside and re-running a single spec still produces the
// throw from helpers/seed-state.ts followed by "No tests found"; this test never
// gets to run. What it does cover: `full`-project specs that never import seed
// state, a file that is present but fails the 35-field shape check, and naming
// the remedy once in a place a reader will find it. Making the explosion itself
// go away means making that module-scope call lazy in ~12 specs, which is a
// bigger change than the debt it buys.
//
// Read-only: this project must never mutate the database. Seeding is the
// container stack's job (pnpm e2e:stack:up); this only reports its absence.

import { test, expect } from '@playwright/test'
import { E2E_SEED_STATE_PATH, readE2eSeedState } from '../helpers/seed-state'

test('seed state is present', () => {
  // The non-throwing variant: a null return means absent OR failing the
  // 35-field shape check, and both have the same remedy.
  expect(
    readE2eSeedState(),
    `E2E seed state missing or invalid (expected ${E2E_SEED_STATE_PATH}). ` +
      `Run the local stack seed or: pnpm exec tsx scripts/seed-e2e-user.ts`,
  ).not.toBeNull()
})
