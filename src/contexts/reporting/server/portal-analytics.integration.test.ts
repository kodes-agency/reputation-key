// Portal results for a Property, read as signed-in members over PostgreSQL with
// the real tenant resolution and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import { getPortalAnalyticsFn } from './portal-analytics'

const harness = setupServerFunctionHarness()

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  return { organization, admin, manager, property, portal }
}

const analytics = (propertyId: string, portalId: string) =>
  getPortalAnalyticsFn({ data: { propertyId, portalId } })

describe('getPortalAnalyticsFn', () => {
  it('reads the Portal in the Property’s own time zone for an AccountAdmin', async () => {
    const { admin, property, portal } = await hotel()
    await harness
      .pool()
      .query(`UPDATE properties SET timezone = 'Europe/Sofia' WHERE id = $1`, [
        property.id,
      ])

    const result = await harness.callAs(admin, () => analytics(property.id, portal.id))

    expect(result.period.timezone).toBe('Europe/Sofia')
    expect(result.localDays).toMatchObject({
      start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it('gives a PropertyManager the Property was granted to the same results', async () => {
    const { manager, property, portal } = await hotel()
    await harness.grantProperty(manager, property)

    const result = await harness.callAs(manager, () => analytics(property.id, portal.id))

    expect(result.period.timezone).toBe('UTC')
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { manager, property, portal } = await hotel()

    await expect(
      harness.callAs(manager, () => analytics(property.id, portal.id)),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { property, portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () => analytics(property.id, portal.id)),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 })
  })

  it('refuses a caller with no session', async () => {
    const { property, portal } = await hotel()

    await expect(
      harness.callAs(null, () => analytics(property.id, portal.id)),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('refuses a Portal id that is not a UUID', async () => {
    const { admin, property } = await hotel()

    await expect(
      harness.callAs(admin, () => analytics(property.id, 'bad')),
    ).rejects.toThrow(/portalId/)
  })
})
