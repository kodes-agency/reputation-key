// Seed the default E2E test account (email+password + org + property) for Playwright CI.
//
// Why: CI e2e previously had no user in the migrated DB, so sign-in timed out
// (~30s × retries × 12 specs ≈ 18 minutes of red "pending" checks that always fail).
// BQR-5.1: also seed a property so critical paths don't depend on removed UI create.
//
// Does NOT boot the full composition root (which requires Redis/jobQueue).
//
// Usage:
//   DATABASE_URL=... BETTER_AUTH_SECRET=... pnpm exec tsx scripts/seed-e2e-user.ts

import 'dotenv/config'
import { eq, and, isNull } from 'drizzle-orm'
import { getAuth } from '../src/shared/auth/auth'
import { getDb } from '../src/shared/db'
import { user, member, organization } from '../src/shared/db/schema/auth'
import { properties } from '../src/shared/db/schema/property.schema'
import {
  betterAuthOrganizationSchema,
  parseBetterAuthResponse,
  signUpResponseSchema,
} from '../src/contexts/identity/infrastructure/adapters/better-auth-schemas'

const email = process.env.E2E_TEST_EMAIL ?? 'test@example.com'
const password = process.env.E2E_TEST_PASSWORD ?? 'password123'
const name = process.env.E2E_TEST_NAME ?? 'E2E Test User'
const organizationName = process.env.E2E_TEST_ORG ?? 'E2E Test Org'
const propertyName = process.env.E2E_TEST_PROPERTY ?? 'E2E Seed Property'
const propertySlug = process.env.E2E_TEST_PROPERTY_SLUG ?? 'e2e-seed-property'

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

async function ensureProperty(orgId: string): Promise<void> {
  const db = getDb()
  const existing = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        eq(properties.organizationId, orgId),
        eq(properties.slug, propertySlug),
        isNull(properties.deletedAt),
      ),
    )
    .limit(1)

  if (existing[0]) {
    console.log(`E2E property already exists: ${propertySlug} (${existing[0].id})`)
    return
  }

  const [row] = await db
    .insert(properties)
    .values({
      organizationId: orgId,
      name: propertyName,
      slug: propertySlug,
      timezone: 'America/New_York',
      countryCode: 'US',
      countrySource: 'manual',
      processingRegion: 'us',
      processingRegionSource: 'country_default',
      routingPolicyVersion: 1,
      processingRegionResolvedAt: new Date(),
      lifecycleState: 'active',
      sourceEpoch: 0,
    })
    .returning({ id: properties.id })

  console.log(`E2E property created: ${propertyName} (${row?.id})`)
}

async function resolveOrgIdForUser(userId: string): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({ orgId: organization.id })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .limit(1)
  return rows[0]?.orgId ?? null
}

async function main(): Promise<void> {
  const auth = getAuth()
  const db = getDb()

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
      await db.update(user).set({ emailVerified: true }).where(eq(user.email, email))
      const existing = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1)
      userId = existing[0]?.id ?? ''
      if (!userId) throw new Error(`Could not resolve existing E2E user id for ${email}`)
    } else {
      throw err
    }
  }

  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId))

  let orgId = await resolveOrgIdForUser(userId)
  if (!orgId) {
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
    orgId = orgParsed.id
    console.log(`E2E org created: ${orgId} (${slug})`)
  } else {
    console.log(`E2E org already exists for user: ${orgId}`)
  }

  await ensureProperty(orgId)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('seed-e2e-user failed:', err)
    process.exit(1)
  })
