// Portal language coverage read, called as signed-in members over PostgreSQL
// with the real tenant resolution, Portal scope lookup and execution policy.

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

import { getPortalLanguageCoverage } from './portal-language-coverage'

const harness = setupServerFunctionHarness()

afterEach(resetCapabilityPolicyStore)

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property, portal }
}

describe('getPortalLanguageCoverage', () => {
  it('answers the Portal’s language coverage to an AccountAdmin', async () => {
    const { admin, portal } = await hotel()

    const coverage = await harness.callAs(admin, () =>
      getPortalLanguageCoverage({ data: { portalId: portal.id } }),
    )

    expect(coverage).toMatchObject({
      portalId: portal.id,
      fallbackLocale: 'en',
      languages: expect.any(Array),
      missingTotal: expect.any(Number),
    })
  })

  it('answers a PropertyManager granted on the Portal’s Property', async () => {
    const { manager, portal } = await hotel()

    const coverage = await harness.callAs(manager, () =>
      getPortalLanguageCoverage({ data: { portalId: portal.id } }),
    )

    expect(coverage.portalId).toBe(portal.id)
  })

  it('refuses a PropertyManager without a grant on the Portal’s Property', async () => {
    const { organization, portal } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        getPortalLanguageCoverage({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })
  })

  it('refuses a Member', async () => {
    const { organization, portal } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        getPortalLanguageCoverage({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive', status: 403 })
  })

  it('does not find a Portal of another Organization', async () => {
    const { portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        getPortalLanguageCoverage({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })

  it('refuses an empty Portal id', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () => getPortalLanguageCoverage({ data: { portalId: '' } })),
    ).rejects.toThrow(/Portal ID is required/)
  })

  it('refuses when Portal reads are switched off', async () => {
    const { admin, portal } = await hotel()
    initCapabilityPolicyStore({
      isCapabilityKilled: (cap) => cap === 'portal.read',
      isOrgSuspended: () => false,
    })

    await expect(
      harness.callAs(admin, () =>
        getPortalLanguageCoverage({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })
  })
})
