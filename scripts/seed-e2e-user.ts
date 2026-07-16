// Seed the default E2E test account (email+password + org) for Playwright CI.
//
// Why: CI e2e previously had no user in the migrated DB, so sign-in timed out
// (~30s × retries × 12 specs ≈ 18 minutes of "pending" checks that always fail).
//
// Does NOT boot the full composition root (which requires Redis/jobQueue).
// Uses Better Auth APIs the same way identity registration does.
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
import { getAuth } from '../src/shared/auth/auth'
import {
  betterAuthOrganizationSchema,
  parseBetterAuthResponse,
  signUpResponseSchema,
} from '../src/contexts/identity/infrastructure/adapters/better-auth-schemas'

const email = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
const password = process.env.E2E_TEST_PASSWORD ?? 'password123'
const name = process.env.E2E_TEST_NAME ?? 'E2E Test User'
const organizationName = process.env.E2E_TEST_ORG ?? 'E2E Test Org'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

async function main(): Promise<void> {
  const auth = getAuth()

  let userId: string
  try {
    const signUp = await auth.api.signUpEmail({
      body: { name, email, password },
    })
    const parsed = parseBetterAuthResponse(
      signUpResponseSchema,
      signUp,
      'registration_failed',
      'Sign-up response did not match expected schema',
    )
    userId = parsed.user.id
    console.log(`E2E user created: ${email} (${userId})`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/already|exists|taken|unique|duplicate/i.test(message)) {
      console.log(`E2E user already exists — ${email}`)
      // Still ensure org exists for this user is harder without login;
      // for CI (fresh DB) the first path always runs.
      return
    }
    throw err
  }

  const slug = `${slugify(organizationName)}-${Date.now().toString(36)}`
  const org = await auth.api.createOrganization({
    body: { name: organizationName, slug, userId },
  })
  const orgParsed = parseBetterAuthResponse(
    betterAuthOrganizationSchema,
    org,
    'org_setup_failed',
    'Invalid organization response from auth provider',
  )
  console.log(`E2E org created: ${orgParsed.id} (${slug})`)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('seed-e2e-user failed:', err)
    process.exit(1)
  })
