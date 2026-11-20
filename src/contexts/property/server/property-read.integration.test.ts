// listProperties, getProperty and deleteProperty, called as signed-in members
// over PostgreSQL with the real tenant resolution and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { deleteProperty, getProperty, listProperties } from './property-read'
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
  return { organization, admin, manager }
}

describe('listProperties', () => {
  it('lists the Properties of the Organization without their Google identity', async () => {
    const { organization, admin } = await hotel()
    const bound = await seedGoogleBoundProperty(harness, organization, {
      lifecycleState: 'archived',
      purgeScheduledFor: new Date(Date.now() + 86_400_000),
    })

    const { properties } = await harness.callAs(admin, () => listProperties())

    const listed = properties.find((p) => p.id === bound.id)
    expectBrowserProperty(listed, bound, { lifecycleState: 'archived' })
  })

  it('lists to a PropertyManager only the Properties they hold a grant for', async () => {
    const { organization, manager } = await hotel()
    const granted = await harness.seedProperty(organization)
    const other = await harness.seedProperty(organization)
    await harness.grantProperty(manager, granted)

    const { properties } = await harness.callAs(manager, () => listProperties())

    expect(properties.map((p) => p.id)).toEqual([granted.id])
    expect(properties.map((p) => p.id)).not.toContain(other.id)
  })

  it('lists nothing from another Organization', async () => {
    const { organization } = await hotel()
    await harness.seedProperty(organization)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    const { properties } = await harness.callAs(otherAdmin, () => listProperties())

    expect(properties).toEqual([])
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(harness.callAs(member, () => listProperties())).rejects.toMatchObject({
      code: 'beta_role_inactive',
    })
  })

  it('refuses a caller with no session', async () => {
    await expect(harness.callAs(null, () => listProperties())).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    })
  })
})

describe('getProperty', () => {
  it('answers a Google-bound Property without its Google identity', async () => {
    const { organization, admin } = await hotel()
    const bound = await seedGoogleBoundProperty(harness, organization, {
      lifecycleState: 'archived',
      purgeScheduledFor: new Date(Date.now() + 86_400_000),
    })

    const { property } = await harness.callAs(admin, () =>
      getProperty({ data: { propertyId: bound.id } }),
    )

    expectBrowserProperty(property, bound, { lifecycleState: 'archived' })
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, manager } = await hotel()
    const property = await harness.seedProperty(organization)

    await expect(
      harness.callAs(manager, () => getProperty({ data: { propertyId: property.id } })),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { organization } = await hotel()
    const property = await harness.seedProperty(organization)
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        getProperty({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
  })
})

describe('deleteProperty', () => {
  it('refuses a stale delete request with a 403 and leaves the Property in place', async () => {
    const { organization, admin } = await hotel()
    const property = await harness.seedProperty(organization)

    await expect(
      harness.callAs(admin, () => deleteProperty({ data: { propertyId: property.id } })),
    ).rejects.toMatchObject({ status: 403 })

    const { rows } = await harness
      .pool()
      .query(`SELECT name, deleted_at FROM properties WHERE id = $1`, [property.id])
    expect(rows).toEqual([{ name: 'Harbour House', deleted_at: null }])
  })
})
