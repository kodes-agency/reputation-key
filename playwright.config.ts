import { defineConfig, devices } from '@playwright/test'

// CI previously used retries: 2. With a missing seed user every test timed out
// at 30s × 3 attempts × 12 specs ≈ 18 minutes of red "pending" e2e — making PR
// checks look stuck long after hard gates (check/storybook-test) were green.
// One retry is enough for true flakes once auth is seeded.
const isCi = !!process.env.CI

export default defineConfig({
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCi,
    timeout: 180_000,
    // Forward e2e capability overrides into the dev server process.
    env: {
      ...process.env,
    },
  },
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: isCi ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
