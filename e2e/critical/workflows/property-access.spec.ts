// BQC-6.5 item 2 — operator-allowlisted property activation and
// wrong-property denial. property_access_grant is the SOLE scope source; the
// grant row's source 'operator' is the operator-allowlist provenance.
//
// Verified at the governed read boundary — the server fns the UI is fed by
// (listProperties is grant-filtered; getProperty denies 403 without an
// active grant). The staff role's UI surfaces are manager-gated today
// (/properties/* redirect to /home, which is manager-shaped), so the
// staff-side assertions target the access model directly rather than a
// rendered property surface; the admin control drives the real list UI.
//
// Transitions verified:
//   staff session works (settings surface renders, zero errors)
//   staff listProperties → ONLY the granted property A (B never listed)
//   staff getProperty(A) → the granted read succeeds (activation)
//   staff getProperty(B) → denied (wrong property), and B is absent from
//     every staff-visible enumeration
//   admin control → the properties UI lists both

import { test, expect } from '../../helpers/error-detection'
import { signIn } from '../../helpers/auth'
import { requireE2eSeedState } from '../../helpers/seed-state'
import {
  e2eRunId,
  cleanupE2eData,
  seedProperty,
  seedStaffUserWithGrant,
  dbQuery,
  callServerFnGet,
  callServerFnGetExpectError,
} from '../../helpers/fixtures'

const PREFIX = 'e2e-acc-'
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

  test('staff is scoped to the granted property; wrong property denies without leaking', async ({
    page,
  }) => {
    const { propertyId: propertyBId } = await seedProperty({
      organizationId: seed.organizationId,
      name: PROPERTY_B_NAME,
      slug: `${PREFIX}b-${e2eRunId}`,
    })
    const staff = await seedStaffUserWithGrant({
      organizationId: seed.organizationId,
      propertyId: seed.propertyId,
      email: `${PREFIX}staff-${e2eRunId}@example.com`,
      name: 'E2E Scoped Staff',
    })

    // Operator-allowlist provenance: the active grant row with source 'operator'.
    const grants = await dbQuery(
      `SELECT source, revoked_at FROM property_access_grant
       WHERE organization_id = $1 AND property_id = $2 AND user_id = $3`,
      [seed.organizationId, seed.propertyId, staff.userId],
    )
    expect(grants).toHaveLength(1)
    expect(grants[0].source).toBe('operator')
    expect(grants[0].revoked_at).toBeNull()

    // The staff session reaches the authenticated area cleanly.
    await signIn(page, staff.email, staff.password, undefined, '/settings/profile')
    await expect(page.getByRole('heading', { name: /profile/i }).first()).toBeVisible({
      timeout: 15_000,
    })

    // The grant-filtered enumeration (what any staff property list is fed
    // by): ONLY the granted property A — B is never listed.
    const listed = await callServerFnGet<PropertyListResult>(page, {
      file: PROPERTY_READ_FILE,
      exportName: 'listProperties',
    })
    const names = listed.properties.map((p) => p.name)
    expect(names).toContain(seed.propertyName)
    expect(names).not.toContain(PROPERTY_B_NAME)
    expect(listed.properties.map((p) => p.id)).not.toContain(propertyBId)

    // Activation through the allowlist: the granted read succeeds.
    const activated = await callServerFnGet<{ property: { id: string; name: string } }>(
      page,
      {
        file: PROPERTY_READ_FILE,
        exportName: 'getProperty',
        data: { propertyId: seed.propertyId },
      },
    )
    expect(activated.property.id).toBe(seed.propertyId)
    expect(activated.property.name).toBe(seed.propertyName)

    // Wrong-property denial: the same read denies for B (no grant), so no
    // staff surface can ever render B's data.
    const denial = await callServerFnGetExpectError(page, {
      file: PROPERTY_READ_FILE,
      exportName: 'getProperty',
      data: { propertyId: propertyBId },
    })
    expect(denial.message ?? '').toMatch(/error|denied/i)
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
