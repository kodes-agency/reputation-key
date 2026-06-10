import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Load .env so that process.env.DATABASE_URL etc. are available for
// integration tests. Vitest doesn't auto-load .env files (only Vite dev
// server does). We load before defineConfig so the fallbacks below see
// the real values.
import { config as dotenvConfig } from 'dotenv'
dotenvConfig()

export default defineConfig({
  resolve: {
    alias: {
      '#': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    // Integration tests share a database and can race on TRUNCATE CASCADE.
    // Run all tests in a single thread so beforeEach truncation doesn't
    // delete data from a parallel test file.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://test:***@localhost:5432/test',
      BETTER_AUTH_SECRET: 'test-test-test-test-test-test-test-test',
      BETTER_AUTH_URL: 'http://localhost:3000',
      RESEND_API_KEY: 're_test_key_for_testing_only',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? 'a'.repeat(64),
      OAUTH_STATE_SECRET: 'ab'.repeat(32),
    },
  },
})
