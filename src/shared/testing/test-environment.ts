// TestEnvironment builder (BQC-6.1) — the ONE canonical, validated source of
// environment variables for test runners (vitest unit + integration projects,
// the Playwright webServer floor). Deterministic: a bare shell with no exports
// and no .env produces a complete, schema-valid env — no bare test command
// requires real secrets or network, and nothing fails zod validation halfway
// through a run (the `GOOGLE_CLIENT_ID ?? ''` defaults this replaces passed
// "is set" but died at the first getEnv() call).
//
// B0.3 stands: nothing here or in the runner configs loads .env — developer
// files that may point at a remote/production database must never leak into
// test runs.
//
// CI parity: every literal below is the exact value the vitest project env
// blocks produced before this builder existed (so CI test behavior is
// byte-identical), and the passthroughs mirror the old blocks one-for-one:
//   - DATABASE_URL honors TEST_DATABASE_URL (never plain DATABASE_URL — a
//     shell DATABASE_URL pointing at a dev database must not redirect tests).
//   - REDIS_URL / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / ENCRYPTION_KEY
//     honor explicit shell/CI values; the fallbacks are the CI workflow
//     placeholders where they exist (ci-placeholder-client-id/secret).
//
// Storybook needs NO env at all: the viteFinal stub aliases in
// .storybook/main.ts (async_hooks, review-reply, observability-logger,
// portal-links) are the boundary that keeps stories import-safe without
// config. test-environment.test.ts pins that boundary.

/** Default scratch database for test runs (local, disposable). */
export const DEFAULT_TEST_DATABASE_URL = 'postgresql://test:test@localhost:5432/test'

/** Default Redis for test runs (local, disposable). */
export const DEFAULT_TEST_REDIS_URL = 'redis://localhost:6379'

/**
 * Default BullMQ Redis for test runs.
 *
 * Separate from the cache Redis on purpose: the local stack runs two servers,
 * because queue keys must never be evicted while cache keys may be. A test that
 * enqueues against the cache URL puts the job somewhere no worker looks.
 */
export const DEFAULT_TEST_QUEUE_REDIS_URL = 'redis://localhost:6379'

/** Deterministic operator token for the /api/health/metrics gate (BQC-7.2). */
export const DEFAULT_TEST_OPS_METRICS_TOKEN = 'e2e-ops-metrics-token-0123456789abcdef'

export type TestEnvironment = Readonly<{
  NODE_ENV: 'test'
  DATABASE_URL: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  RESEND_API_KEY: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ENCRYPTION_KEY: string
  OAUTH_STATE_SECRET: string
  REDIS_URL: string
  QUEUE_REDIS_URL: string
  OPS_METRICS_TOKEN: string
}>

/**
 * The canonical deterministic test env. Every value is non-empty.
 *
 * @param readEnv - source for the explicit-override passthroughs (defaults to
 *   the real process env; tests pass a literal to prove the deterministic
 *   floor and the passthrough behavior independently).
 */
export function testEnvironment(
  readEnv: NodeJS.ProcessEnv = process.env,
): TestEnvironment {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: readEnv.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
    BETTER_AUTH_SECRET: 'test-test-test-test-test-test-test-test',
    BETTER_AUTH_URL: 'http://localhost:3000',
    RESEND_API_KEY: 're_test_key_for_testing_only',
    GOOGLE_CLIENT_ID: readEnv.GOOGLE_CLIENT_ID ?? 'ci-placeholder-client-id',
    GOOGLE_CLIENT_SECRET: readEnv.GOOGLE_CLIENT_SECRET ?? 'ci-placeholder-client-secret',
    ENCRYPTION_KEY: readEnv.ENCRYPTION_KEY ?? 'a'.repeat(64),
    OAUTH_STATE_SECRET: 'ab'.repeat(32),
    REDIS_URL: readEnv.REDIS_URL ?? DEFAULT_TEST_REDIS_URL,
    QUEUE_REDIS_URL:
      readEnv.QUEUE_REDIS_URL ?? readEnv.REDIS_URL ?? DEFAULT_TEST_QUEUE_REDIS_URL,
    OPS_METRICS_TOKEN: readEnv.OPS_METRICS_TOKEN ?? DEFAULT_TEST_OPS_METRICS_TOKEN,
  }
}
