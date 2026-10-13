// BQC-6.5 item 2 — operator-allowlisted property activation and
// wrong-property denial. property_access_grant is the SOLE scope source; the
// grant row's source 'operator' is the operator-allowlist provenance.
//
// The scoped login is a PropertyManager with one grant, which is what every
// property-scoped account of the closed beta is. From 2026-08-30 to 2026-10-13
// this test was skipped: it signed in as a Member, and Member login is dark.
// What it proves never depended on that role, and meanwhile no e2e spec asked
// for a second Property's read as a scoped user.
//
// Verified in the manager's own session: on the Properties page, and at the
// governed read boundary — the server fns the UI is fed by (listProperties is
// grant-filtered; getProperty answers 403 without an active grant).
//
// Transitions verified:
//   the manager's Properties page shows the granted property A and not B
//   listProperties → ONLY the granted property A (B never listed)
//   getProperty(A) → the granted read succeeds (activation)
//   getProperty(B) → 403 (wrong property)
//   admin control → the properties UI lists both

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedProperty,
  seedMemberUserWithGrant,
  dbQuery,
  callServerFnGet,
  callServerFnGetExpectError,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-acc-'
const BASE_ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const seed = requireE2eSeedState()
const PROPERTY_B_NAME = `E2E Access Denied Hotel ${e2eRunId}`
const PROPERTY_READ_FILE = 'src/contexts/property/server/property-read.ts'

type PropertyListResult = Readonly<{
  properties: ReadonlyArray<{ id: string; name: string }>
}>

test.describe('Critical workflow: property access (operator allowlist)', () => {
  test.beforeEach(async () => {
    await cleanupE2eData({ organizationId: seed.organizationId, prefix: PREFIX })
  })

  test('a PropertyManager is scoped to the granted property; another property is refused', async ({
    browser,
  }) => {
    const { propertyId: propertyBId } = await seedProperty({
      organizationId: seed.organizationId,
      name: PROPERTY_B_NAME,
      slug: `${PREFIX}b-${e2eRunId}`,
    })
    // role 'admin' = PropertyManager: a membership and this one grant.
    const manager = await seedMemberUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      email: `${PREFIX}manager-${e2eRunId}@example.com`,
      name: 'E2E Scoped Manager',
      role: 'admin',
    })

    // Operator-allowlist provenance: the active grant row with source 'operator'.
    const grants = await dbQuery(
      `SELECT source, revoked_at FROM property_access_grant
       WHERE organization_id = $1 AND property_id = $2 AND user_id = $3`,
      [seed.organizationId, seed.propertyId, manager.userId],
    )
    expect(grants).toHaveLength(1)
    expect(grants[0].source).toBe('operator')
    expect(grants[0].revoked_at).toBeNull()

    // The manager's own session, in its own context, as the other specs that
    // sign a grant-only manager in do (inbox-property-manager, member-access).
    const context = await browser.newContext({ baseURL: BASE_ORIGIN })
    try {
      const page = await context.newPage()
      await signIn(page, manager.email, manager.password, BASE_ORIGIN)

      // The page a manager works from shows what they were granted, and only that.
      await page.goto('/properties')
      await expect(page.getByText(seed.propertyName).first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText(PROPERTY_B_NAME)).toHaveCount(0)

      // The grant-filtered enumeration that page is fed by: ONLY the granted
      // property A — B is never listed.
      const listed = await callServerFnGet<PropertyListResult>(page, {
        file: PROPERTY_READ_FILE,
        exportName: 'listProperties',
      })
      const names = listed.properties.map((p) => p.name)
      expect(names).toContain(seed.propertyName)
      expect(names).not.toContain(PROPERTY_B_NAME)
      expect(listed.properties.map((p) => p.id)).not.toContain(propertyBId)

      // Activation through the allowlist: the granted read succeeds.
      const activated = await callServerFnGet<{
        property: { id: string; name: string }
      }>(page, {
        file: PROPERTY_READ_FILE,
        exportName: 'getProperty',
        data: { propertyId: seed.propertyId },
      })
      expect(activated.property.id).toBe(seed.propertyId)
      expect(activated.property.name).toBe(seed.propertyName)

      // Wrong-property denial: the same read is refused for B (no grant), by
      // the policy and as a 403, so no surface of this manager can render B.
      const denial = await callServerFnGetExpectError(page, {
        file: PROPERTY_READ_FILE,
        exportName: 'getProperty',
        data: { propertyId: propertyBId },
      })
      expect(denial.status).toBe(403)
    } finally {
      await context.close()
    }
  })

  test('admin control sees every org property', async ({ page }) => {
    await seedProperty({
      organizationId: seed.organizationId,
      name: PROPERTY_B_NAME,
      slug: `${PREFIX}b-${e2eRunId}`,
    })
    await signIn(page)
    await page.goto('/properties')
    await expect(page.getByText(seed.propertyName).first()).toBeVisible()
    await expect(page.getByText(PROPERTY_B_NAME).first()).toBeVisible()
  })
})
