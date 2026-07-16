import { defineConfig, devices } from '@playwright/test'

// CI previously used retries: 2. With a missing seed user every test timed out
// at 30s × 3 attempts × 12 specs ≈ 18 minutes of red "pending" e2e.
// BQR-5.1: critical project is a hard gate; residual stays soft in CI.

const isCi = !!process.env.CI

export default defineConfig({
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCi,
    timeout: 180_000,
    env: {
      ...process.env,
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
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
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
