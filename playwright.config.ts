import { defineConfig, devices } from '@playwright/test'

// CI previously used retries: 2. With a missing seed user every test timed out
// at 30s × 3 attempts × 12 specs ≈ 18 minutes of red "pending" e2e.
// BQR-5.1: critical project is a hard gate. BQC-6.7: the full project is a
// hard gate too (deterministic — fake mail outbox, hydration-safe specs,
// F-PEOPLE fix — and green).
//
// BQC-6.4 — retries: 0 is the INTENTIONAL choice: the suite is deterministic
// (6.1 env floor, 6.2 error-injection proofs) and there is no independently
// justified infrastructure instability a retry would absorb — a retry would
// only mask real defects. Never pair retries: 0 with trace: 'on-first-retry'
// (no retry ⇒ a trace is NEVER captured). Diagnostics are failure-retained
// instead: trace/screenshot/video are recorded on the FIRST failing run, kept
// under outputDir, and uploaded by the ci.yml e2e job.
//
// BETA-LOCAL — Playwright is a pure browser client. The Docker application
// stack owns both production-profile web processes, the worker, migrations,
// seed, object store, and provider sandboxes. `pnpm test:e2e:local` is the
// lifecycle entry point; direct `pnpm test:e2e` consumes E2E_BASE_URL and
// E2E_LOCKED_BASE_URL from an already-smoked stack.

const isCi = !!process.env.CI

export default defineConfig({
  // No global setup/teardown and no webServer: host Playwright owns no
  // application process. The stack controller always tears down containers.
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCi,
  retries: 0,
  workers: isCi ? 1 : undefined,
  reporter: 'list',
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
      name: 'critical',
      testMatch: /critical\/.*\.spec\.ts/,
      // Critical journeys mutate shared policy state and restore it; one worker
      // prevents another browser from observing the bounded kill-switch window.
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full',
      testMatch: /^(?!.*\/critical\/).*\.spec\.ts$/,
    },
  ],
})
