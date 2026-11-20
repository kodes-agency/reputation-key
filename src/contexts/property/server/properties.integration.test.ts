// updateProperty, called as signed-in members over PostgreSQL with the real
// tenant resolution, grants and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { updateProperty } from './properties'
import {
  expectBrowserProperty,
  seedGoogleBoundProperty,
} from './property-server.test-fixtures'

// A Google connection cannot go while a Property still names it, so the
// Properties are deleted ahead of their connections.
const harness = setupServerFunctionHarness({
  cleanupTables: ['properties', 'google_connections'],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  return { organization, admin, manager, property }
}

async function storedRow(propertyId: string) {
  const { rows } = await harness
    .pool()
    .query(`SELECT name, profile_version FROM properties WHERE id = $1`, [propertyId])
  return rows[0] as { name: string; profile_version: number }
}

describe('updateProperty', () => {
  it('renames the Property for an AccountAdmin and bumps its profile version', async () => {
    const { admin, property } = await hotel()
    const before = await storedRow(property.id)

    const response = await harness.callAs(admin, () =>
      updateProperty({ data: { propertyId: property.id, name: 'Quay House' } }),
    )

    expect(response.property).toMatchObject({ id: property.id, name: 'Quay House' })
    const after = await storedRow(property.id)
    expect(after.name).toBe('Quay House')
    expect(after.profile_version).toBeGreaterThan(before.profile_version)
  })

  it('answers a Google-bound Property without its Google identity', async () => {
    const { organization, admin } = await hotel()
    const bound = await seedGoogleBoundProperty(harness, organization)

    const response = await harness.callAs(admin, () =>
      updateProperty({ data: { propertyId: bound.id, name: 'Harbour Hotel' } }),
    )

    expectBrowserProperty(response.property, bound, { lifecycleState: 'active' })
  })

  it('lets a PropertyManager rename a Property they hold a grant for', async () => {
    const { manager, property } = await hotel()
    await harness.grantProperty(manager, property)

    await harness.callAs(manager, () =>
      updateProperty({ data: { propertyId: property.id, name: 'Granted Name' } }),
    )

    expect((await storedRow(property.id)).name).toBe('Granted Name')
  })

  it('refuses a PropertyManager without a grant and leaves the Property alone', async () => {
    const { property, manager } = await hotel()
    const before = await storedRow(property.id)

    await expect(
      harness.callAs(manager, () =>
        updateProperty({ data: { propertyId: property.id, name: 'Not Granted' } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })

    expect(await storedRow(property.id)).toEqual(before)
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        updateProperty({ data: { propertyId: property.id, name: 'Nope' } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive', status: 403 })

    expect((await storedRow(property.id)).name).toBe('Harbour House')
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        updateProperty({ data: { propertyId: property.id, name: 'Nope' } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
    expect((await storedRow(property.id)).name).toBe('Harbour House')
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        updateProperty({ data: { propertyId: property.id, name: 'Nope' } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
    expect((await storedRow(property.id)).name).toBe('Harbour House')
  })

  it('refuses an empty Property id with a validation error, not a sign-in refusal', async () => {
    await expect(
      harness.callAs(null, () => updateProperty({ data: { propertyId: '' } })),
    ).rejects.toThrow(/propertyId|Property ID/)
  })

  it('refuses a name that is only whitespace', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        updateProperty({ data: { propertyId: property.id, name: '   ' } }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_name', status: 400 })
    expect((await storedRow(property.id)).name).toBe('Harbour House')
  })

  it('refuses a slug another Property of the Organization already has', async () => {
    const { organization, admin, property } = await hotel()
    const other = await harness.seedProperty(organization)
    const { rows } = await harness
      .pool()
      .query(`SELECT slug FROM properties WHERE id = $1`, [other.id])

    await expect(
      harness.callAs(admin, () =>
        updateProperty({
          data: { propertyId: property.id, slug: (rows[0] as { slug: string }).slug },
        }),
      ),
    ).rejects.toMatchObject({ code: 'slug_taken', status: 409 })
  })
})
