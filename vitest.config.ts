import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { testEnvironment } from './src/shared/testing/test-environment'

// B0.3: Do NOT load .env here — Vitest must not inherit developer .env
// files that may point to a remote/production database. Test env vars come
// from the canonical builder (src/shared/testing/test-environment.ts, BQC-6.1)
// spread into each project env block below: deterministic non-empty values in
// a bare shell, with documented passthroughs (TEST_DATABASE_URL, REDIS_URL,
// Google credentials, ENCRYPTION_KEY) for explicit shell/CI overrides.

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
    // BQC-6.9: coverage is OFF by default (bare `vitest run` / `pnpm test`
    // stay fast). The coverage gate (scripts/check-coverage.mjs →
    // `pnpm check:coverage`) runs the unit project itself with
    // `--coverage.enabled=true`; these defaults shape that run.
    coverage: {
      provider: 'v8',
      // Count every included source file, not just the ones tests import —
      // an untested file must lower the baseline, not vanish from it.
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.stories.tsx',
        'src/routeTree.gen.ts',
        'src/test-setup.ts',
        // Test-only helpers (fixtures/builders) are not production code.
        'src/shared/testing/**',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
    },
    // Two isolated projects: `unit` (node integration tests, scoped via
    // `pnpm test` → `vitest run --project=unit`) and `storybook` (browser
    // component tests via @storybook/addon-vitest, scoped by the addon when
    // triggered through the dev server / MCP `run-story-tests` tool).
    projects: [
      {
        // PRE17C: Pure unit tests — no DB, no Redis. Runs in parallel
        // for fast CI feedback. Excludes repository integration tests
        // and migration verification (those need a database service).
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'src/**/*.test.ts',
            'services/**/*.test.ts',
            'e2e/fixtures/**/*.test.ts',
            // The e2e HELPERS are ordinary Node modules with no browser
            // dependency (polling, allowlist bookkeeping, raw SQL builders), and
            // bugs in them present as product-spec failures in the slowest job
            // in CI. `e2e/fixtures/**` was already here for the same reason.
            'e2e/helpers/**/*.test.ts',
            // Same reasoning for the local-stack harness: its pure helpers are
            // ordinary Node modules, and a bug in one presents as a beta
            // acceptance-gate failure two hours into the slowest job on main.
            'scripts/local-stack/**/*.test.ts',
          ],
          exclude: [
            'src/**/infrastructure/repositories/*.test.ts',
            'src/**/*.integration.test.ts',
            'src/shared/db/migration-verification.test.ts',
          ],
          setupFiles: ['src/test-setup.ts'],
          pool: 'forks',
          maxWorkers: 4,
          testTimeout: 30_000,
          env: {
            // BQC-6.1: canonical deterministic test env (bare shell runs green).
            ...testEnvironment(),
            ALLOW_DESTRUCTIVE_DB_TESTS: '1',
          },
        },
      },
      {
        // PRE17C: Integration tests — need PostgreSQL. Run serially
        // (maxWorkers: 1) because tests share a database and can race
        // on TRUNCATE CASCADE.
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: [
            'src/**/infrastructure/repositories/*.test.ts',
            'src/**/*.integration.test.ts',
            'src/shared/db/migration-verification.test.ts',
          ],
          setupFiles: ['src/test-setup.ts'],
          // BQC-6.1: create + migrate the scratch database before the suite
          // (idempotent — fast-skips when the deploy migration state is present).
          globalSetup: ['src/shared/testing/integration-global-setup.ts'],
          pool: 'forks',
          maxWorkers: 1,
          testTimeout: 30_000,
          env: {
            // BQC-6.1: canonical deterministic test env (bare shell runs green).
            ...testEnvironment(),
            ALLOW_DESTRUCTIVE_DB_TESTS: '1',
          },
        },
      },
      ...storybookProject,
    ],
  },
})
