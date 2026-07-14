import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'

// B0.3: Do NOT load .env here — Vitest must not inherit developer .env
// files that may point to a remote/production database. Test env vars are
// set explicitly in the project env block below. CI sets them via the
// workflow env: key.

// The storybook browser project is only included when VITEST_STORYBOOK=true,
// which the @storybook/addon-vitest manager sets at module load (it runs inside
// the storybook dev server process). This keeps bare `vitest run` — and
// `pnpm test`, which scopes via --project=unit — from initializing the Playwright
// browser provider. The same env var is what makes the storybookTest plugin
// force-name the project `storybook:<configDir>` (the exact name the manager
// filters by), so existence and naming stay consistent. The `test:storybook`
// CLI script sets VITEST_STORYBOOK=true explicitly to opt in.
const storybookProject =
  process.env.VITEST_STORYBOOK === 'true'
    ? [
        {
          // The storybookTest plugin transforms stories into vitest tests, runs
          // them in headless Chromium, auto-names this project `storybook:<configDir>`
          // (matches the filter the addon's VitestManager uses), and merges the
          // Storybook vite config — including the viteFinal stub aliases in
          // .storybook/main.ts (async_hooks / review-reply / observability-logger)
          // — so no manual setup file or alias duplication is needed.
          extends: true,
          plugins: [storybookTest({ configDir: resolve(__dirname, '.storybook') })],
          test: {
            browser: {
              enabled: true,
              headless: true,
              provider: playwright({}),
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ]
    : []

export default defineConfig({
  resolve: {
    alias: {
      '#': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    // Two isolated projects: `unit` (node integration tests, scoped via
    // `pnpm test` → `vitest run --project=unit`) and `storybook` (browser
    // component tests via @storybook/addon-vitest, scoped by the addon when
    // triggered through the dev server / MCP `run-story-tests` tool).
    projects: [
      {
        // Integration tests share a database and can race on TRUNCATE CASCADE.
        // Run all tests in a single worker (maxWorkers: 1) so beforeEach
        // truncation doesn't delete data from a parallel test file. (Vitest 4
        // flattened poolOptions.forks.singleFork into the top-level option.)
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          setupFiles: ['src/test-setup.ts'],
          pool: 'forks',
          maxWorkers: 1,
          testTimeout: 30_000,
          env: {
            NODE_ENV: 'test',
            // B0.3: Never inherit the production DATABASE_URL from the shell.
            // Tests use a local disposable database. Override with TEST_DATABASE_URL
            // if your local PostgreSQL uses a non-default port or credentials.
            DATABASE_URL:
              process.env.TEST_DATABASE_URL ??
              'postgresql://test:test@localhost:5432/test',
            BETTER_AUTH_SECRET: 'test-test-test-test-test-test-test-test',
            BETTER_AUTH_URL: 'http://localhost:3000',
            RESEND_API_KEY: 're_test_key_for_testing_only',
            GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
            GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
            ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? 'a'.repeat(64),
            OAUTH_STATE_SECRET: 'ab'.repeat(32),
            ALLOW_DESTRUCTIVE_DB_TESTS: '1',
            REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
          },
        },
      },
      ...storybookProject,
    ],
  },
})
