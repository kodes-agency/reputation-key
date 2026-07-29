import { defineConfig, devices } from '@playwright/test'
import { testEnvironment } from './src/shared/testing/test-environment'

// CI previously used retries: 2. With a missing seed user every test timed out
// at 30s × 3 attempts × 12 specs ≈ 18 minutes of red "pending" e2e.
// BQR-5.1: critical project is a hard gate; residual stays soft in CI.
//
// BQC-6.4 — retries: 0 is the INTENTIONAL choice: the suite is deterministic
// (6.1 env floor, 6.2 error-injection proofs) and there is no independently
// justified infrastructure instability a retry would absorb — a retry would
// only mask real defects. Never pair retries: 0 with trace: 'on-first-retry'
// (no retry ⇒ a trace is NEVER captured). Diagnostics are failure-retained
// instead: trace/screenshot/video are recorded on the FIRST failing run, kept
// under outputDir, and uploaded by the ci.yml e2e job.

const isCi = !!process.env.CI

export default defineConfig({
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCi,
    timeout: 180_000,
    // BQC-6.4: stderr carries real server errors into the job log (pipe);
    // stdout stays out (ignore — Playwright's default). The noisy channel was
    // never the server's own output but the devtools console-pipe mirroring
    // browser console into the server terminal: a mirrored console.error
    // lands on stderr, so one client error flooded CI. E2E=1 (below) tells
    // vite.config.ts to disable that pipe at the source; local `pnpm dev`
    // keeps it for DX.
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      // BQC-6.1: deterministic test-env floor for the dev server — explicit
      // shell/CI values win (spread last), matching the previous behavior of
      // inheriting the job env verbatim.
      ...testEnvironment(),
      ...process.env,
      // After the spreads so nothing can unset it: only Playwright-launched
      // dev servers run with the console-pipe disabled (see above).
      E2E: '1',
    },
  },
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCi,
  retries: 0,
  workers: isCi ? 1 : undefined,
  reporter: 'list',
  // Explicit default (BQC-6.4): the ci.yml upload steps point here.
  outputDir: 'test-results',
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
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'full',
      testIgnore: /critical\/.*/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
