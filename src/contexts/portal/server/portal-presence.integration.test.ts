// "Does this scope have a Portal?" called as signed-in members over PostgreSQL
// with the real tenant resolution and execution policy.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getPortalPresence } from './portal-presence'

const harness = setupServerFunctionHarness()

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const outsider = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const harbour = await harness.seedProperty(organization)
  const garden = await harness.seedProperty(organization)
  await harness.seedPortal(harbour)
  await harness.grantProperty(manager, harbour)
  return { organization, admin, manager, outsider, member, harbour, garden }
}

afterEach(resetCapabilityPolicyStore)

describe('getPortalPresence', () => {
  it('refuses when Portal reads are switched off', async () => {
    const { admin, harbour } = await hotel()
    initCapabilityPolicyStore({
      isCapabilityKilled: (cap) => cap === 'portal.read',
      isOrgSuspended: () => false,
    })

    await expect(
      harness.callAs(admin, () =>
        getPortalPresence({ data: { propertyId: harbour.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })
  })

  it('says a Property has a Portal only when it holds one', async () => {
    const { admin, harbour, garden } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        getPortalPresence({ data: { propertyId: harbour.id } }),
      ),
    ).resolves.toEqual({ hasPortal: true })
    await expect(
      harness.callAs(admin, () => getPortalPresence({ data: { propertyId: garden.id } })),
    ).resolves.toEqual({ hasPortal: false })
  })

  it('says the Organization has one when any Property the reader may see holds one', async () => {
    const { admin, manager } = await hotel()

    await expect(
      harness.callAs(admin, () => getPortalPresence({ data: {} })),
    ).resolves.toEqual({
      hasPortal: true,
    })
    await expect(
      harness.callAs(manager, () => getPortalPresence({ data: {} })),
    ).resolves.toEqual({ hasPortal: true })
  })

  it('says no for an Organization whose Properties hold no Portal', async () => {
    const organization = await harness.seedOrganization()
    const admin = await harness.seedMember(organization, 'AccountAdmin')
    await harness.seedProperty(organization)

    await expect(
      harness.callAs(admin, () => getPortalPresence({ data: {} })),
    ).resolves.toEqual({
      hasPortal: false,
    })
  })

  it('counts only the Properties the reader may see, without refusing the whole question', async () => {
    const { outsider } = await hotel()

    await expect(
      harness.callAs(outsider, () => getPortalPresence({ data: {} })),
    ).resolves.toEqual({ hasPortal: false })
  })

  it('refuses a question about a Property the reader has no grant on', async () => {
    const { outsider, harbour } = await hotel()

    await expect(
      harness.callAs(outsider, () =>
        getPortalPresence({ data: { propertyId: harbour.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })
})
