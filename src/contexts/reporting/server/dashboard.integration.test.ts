// The Property overview, read as signed-in members over PostgreSQL with the
// real tenant resolution and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { getPropertyOverviewFn } from './dashboard'

const harness = setupServerFunctionHarness()

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  return { organization, admin, manager, property }
}

const overview = (propertyId: string) => getPropertyOverviewFn({ data: { propertyId } })

describe('getPropertyOverviewFn', () => {
  it('gives an AccountAdmin the overview of a Property of their Organization', async () => {
    const { admin, property } = await hotel()

    const result = await harness.callAs(admin, () => overview(property.id))

    expect(result).toHaveProperty('dashboard')
    expect(result).toHaveProperty('signals')
    expect(result).toHaveProperty('google')
  })

  it('gives a PropertyManager the Property was granted to the same overview', async () => {
    const { manager, property } = await hotel()
    await harness.grantProperty(manager, property)

    const result = await harness.callAs(manager, () => overview(property.id))

    expect(result).toHaveProperty('dashboard')
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { manager, property } = await hotel()

    await expect(
      harness.callAs(manager, () => overview(property.id)),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () => overview(property.id)),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(harness.callAs(null, () => overview(property.id))).rejects.toMatchObject(
      { code: 'unauthorized', status: 401 },
    )
  })

  it('refuses a Property id that is not a UUID', async () => {
    const { admin } = await hotel()

    await expect(harness.callAs(admin, () => overview('bad'))).rejects.toThrow(
      /propertyId/,
    )
  })
})
