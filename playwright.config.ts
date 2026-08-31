import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { localStackPlaywrightEnv } from './src/shared/testing/local-stack-playwright-env'
import { COMPATIBILITY_PROJECTS } from './e2e/helpers/compatibility-projects'
import { DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT } from './e2e/deployed/deployed-target'

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
// Diagnostics stay failure-retained (trace/screenshot/video on the first
// failing run, uploaded by the ci.yml e2e job) rather than 'on-first-retry',
// so the artifact exists whether or not the retry saves the run.
//
// BETA-LOCAL — Playwright is a pure browser client. The Docker application
// stack owns both production-profile web processes, the worker, migrations,
// seed, object store, and provider sandboxes. `pnpm test:e2e:local` is the
// lifecycle entry point; direct `pnpm test:e2e` consumes E2E_BASE_URL and
// E2E_LOCKED_BASE_URL from an already-smoked stack.

const isCi = !!process.env.CI

// `pnpm e2e:stack:up` GENERATES per-run credentials and host ports into
// .local-stack/e2e/stack.env and passes them to the containers. A host Playwright
// process that does not read that file falls back to defaults, which is why every
// sign-in returned 401 (wrong password) and every fixture helper failed to connect
// (no TEST_DATABASE_URL). `pnpm test:e2e:local` routes through the runner that
// applies it; a bare `pnpm test:e2e` did not. Applied here so both entry points
// behave the same. Values already present in the environment always win, so an
// explicit override still works against a hand-seeded database.
const generatedStackEnv = resolve(process.cwd(), '.local-stack/e2e/stack.env')
if (existsSync(generatedStackEnv)) {
  for (const [key, value] of Object.entries(localStackPlaywrightEnv(generatedStackEnv))) {
    process.env[key] ??= value
  }
}

export default defineConfig({
  // No globalSetup/teardown and no webServer: host Playwright owns no
  // application process. The stack controller always tears down containers.
  // The one precondition the host DOES own — e2e/.seed-state.json — is the
  // `setup` project below, so it reports as a named test rather than a
  // load-time throw and applies to single-file invocations too.
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
    // BQC-6.4: failure-retained diagnostics on the first (only) attempt.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full',
      testMatch: /^(?!.*\/critical\/).*\.spec\.ts$/,
      // REL-01: `deployed/` MUST stay in this ignore list. The testMatch above
      // only excludes `critical/`, so without this entry the local full run
      // would load e2e/deployed/closed-beta-critical-journeys.spec.ts, whose
      // target guard throws — and, if DEPLOYED_BASE_URL happened to be
      // exported, would point the local suite at production.
      testIgnore: [/compatibility\/.*\.spec\.ts/, /deployed\/.*\.spec\.ts/],
      dependencies: ['setup'],
    },
    // REL-01 deployed critical journeys: retries 0, workers 1, and no `setup`
    // dependency (the local seed state neither exists nor may exist for a
    // production target). Only `pnpm release:deployed-journeys` invokes it.
    DEPLOYED_CRITICAL_PLAYWRIGHT_PROJECT,
    ...COMPATIBILITY_PROJECTS,
  ],
})
