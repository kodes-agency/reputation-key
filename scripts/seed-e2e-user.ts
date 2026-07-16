// Seed the default E2E test account (email+password + org) for Playwright CI.
//
// Why: CI e2e previously had no user in the migrated DB, so sign-in timed out
// (~30s × retries × 12 specs ≈ 18 minutes of "pending" checks that always fail).
//
// Usage:
//   DATABASE_URL=... BETTER_AUTH_SECRET=... pnpm exec tsx scripts/seed-e2e-user.ts
//
// Env (optional):
//   E2E_TEST_EMAIL    default test@example.com
//   E2E_TEST_PASSWORD default password123
//   E2E_TEST_NAME     default E2E Test User
//   E2E_TEST_ORG      default E2E Test Org

import 'dotenv/config'
import { getContainer } from '../src/composition'
import { getLogger } from '../src/shared/observability/logger'

const email = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
const password = process.env.E2E_TEST_PASSWORD ?? 'password123'
const name = process.env.E2E_TEST_NAME ?? 'E2E Test User'
const organizationName = process.env.E2E_TEST_ORG ?? 'E2E Test Org'

async function main(): Promise<void> {
  const logger = getLogger()
  const { useCases } = getContainer()

  try {
    const result = await useCases.registerUserAndOrg({
      name,
      email,
      password,
      organizationName,
    })
    logger.info({ email, organizationId: result.organizationId }, 'E2E user seeded')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Idempotent: re-running against an already-seeded DB is fine.
    if (
      /already|exists|taken|unique|duplicate/i.test(message) ||
      (err as { code?: string }).code === 'already_exists'
    ) {
      logger.info({ email }, 'E2E user already exists — skipping seed')
      return
    }
    throw err
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('seed-e2e-user failed:', err)
    process.exit(1)
  })
