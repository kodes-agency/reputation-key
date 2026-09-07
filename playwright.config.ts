import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'
import { localStackPlaywrightEnv } from './src/shared/testing/local-stack-playwright-env'
import { COMPATIBILITY_PROJECTS } from './e2e/helpers/compatibility-projects'

// CI previously used retries: 2. With a missing seed user every test timed out
// at 30s × 3 attempts × 12 specs ≈ 18 minutes of red "pending" e2e.
// BQR-5.1: critical project is a hard gate. BQC-6.7: the full project is a
// hard gate too (deterministic — fake mail outbox, hydration-safe specs,
// F-PEOPLE fix — and green).
//
// BQC-6.4 chose retries: 0 so a retry could never mask a real defect. The
// reasoning was right and the mechanism was backwards in practice: with no
// retry, a flake and a bug are indistinguishable until a human spends ~10
// minutes re-running the job to find out. That happened three times in one
// session, on top of the six occurrences recorded in
// google-import-sync.spec.ts, and it trains reflexive re-running — which masks
// intermittent defects far more effectively than a retry does.
//
// Now: one retry in CI, and the RELEASE path refuses a flaky suite. The e2e job
// passes --fail-on-flaky-tests on pushes to main, so a test that only passes on
// retry FAILS main and has to be fixed or quarantined; on a PR the same test
// reports `flaky` in the log and the run stays green, so nobody pays the rerun
// tax to learn what the first attempt already showed. Locally retries stay 0.
// Every occurrence goes in docs/operations/e2e-flake-register.md.
//
// Diagnostics keep the first failing attempt's trace, screenshot, and video.
// CI uploads the directory before the next suite starts, so a successful retry
// cannot erase the evidence that made the run flaky.
//
// Playwright is a pure browser client. Compose owns the containerised
// production build, worker and provider sandboxes; NODE_ENV=test activates the
// supported one-Redis topology. Direct `pnpm test:e2e` consumes an already
// seeded stack at E2E_BASE_URL and E2E_LOCKED_BASE_URL.

const isCi = !!process.env.CI

// The committed stack environment is shared by Compose, migration/seed host
// commands, and Playwright. Explicit process values still win so the same
// project can target an independently managed stack.
const stackEnv = resolve(process.cwd(), 'e2e/stack.env')
for (const [key, value] of Object.entries(localStackPlaywrightEnv(stackEnv))) {
  process.env[key] ??= value
}

export default defineConfig({
  // No globalSetup/teardown and no webServer: host Playwright owns no
  // application process. The one precondition it owns — e2e/.seed-state.json —
  // is the `setup` project below, so it reports as a named test.
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : undefined,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile:
          process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ??
          'test-results/playwright-report.json',
      },
    ],
  ],
  // Isolate browser artifacts so Playwright cleanup cannot delete local-stack
  // or beta-smoke evidence written under sibling test-results directories.
  outputDir: 'test-results/playwright',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    // BQC-6.4: retain the original failure even when retry 1 passes.
    trace: 'retain-on-first-failure',
    screenshot: 'on-first-failure',
    video: 'retain-on-first-failure',
  },
  projects: [
    {
      // The suite's precondition gate (e2e/.seed-state.json). Declared as a
      // project dependency rather than a globalSetup so a failure is reported
      // as one named test instead of a load-time throw in every spec, and so
      // any single-file invocation still runs it.
      name: 'setup',
      testMatch: /setup\/.*\.setup\.ts/,
    },
    {
      name: 'critical',
      testMatch: /critical\/.*\.spec\.ts/,
      dependencies: ['setup'],
      // Critical journeys mutate shared policy state and restore it; one worker
      // prevents another browser from observing the bounded kill-switch window.
      workers: 1,
      // Shard granularity, not execution order. `--shard` distributes "test
      // groups", and a group is one FILE when fullyParallel is false or one
      // TEST when it is true. With `workers: 1` above, both settings execute
      // identically inside a shard — declaration order, one browser — so this
      // only constrains where --shard may cut.
      //
      // It must cut on file boundaries. These journeys depend on the order they
      // are declared in, and measured against the inherited `fullyParallel:
      // true`, `--shard=N/4` put auth-and-shell.spec.ts in shards 1 AND 2 and
      // guest-portal.spec.ts in 2 AND 3, running the back half of a file
      // without its front half. `--shard=N/3` happened to align to files, but
      // that was arithmetic luck: one added test would have moved the cut
      // silently, and the symptom would have been a CI flake, not an error.
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full',
      testMatch: /^(?!.*\/critical\/).*\.spec\.ts$/,
      testIgnore: /compatibility\/.*\.spec\.ts/,
      dependencies: ['setup'],
    },
    ...COMPATIBILITY_PROJECTS,
  ],
})
