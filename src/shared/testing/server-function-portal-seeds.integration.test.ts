// The harness's live-Portal, Portal-group and staff seeds, proven through the
// server functions that read them: a guest opens the published Portal by its
// address and by a print code, a manager lists the group, and the staff member
// finds their own participation.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'
import { PORTAL_SEED_CLEANUP_TABLES } from '#/shared/testing/server-function-portal-seeds'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getPublicPortal } from '#/contexts/guest/server/guest-scans'
import { getMyStaffHome } from '#/contexts/identity/server/staff-self'
import { listPortalGroups } from '#/contexts/portal/server/portal-groups'

const harness = setupServerFunctionHarness({ cleanupTables: PORTAL_SEED_CLEANUP_TABLES })

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization)
  return { organization, admin, property }
}

describe('seedPublishedPortal', () => {
  it('makes a Portal a guest opens by its address, with Google offered and a session issued', async () => {
    const { property } = await hotel()
    const portal = await harness.seedPublishedPortal(property)

    const response = await harness.respondAs(null, () =>
      getPublicPortal({ data: { token: portal.rawToken ?? '' } }),
    )

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.value.reviewGateway.googleReview.status).toBe('available')
    expect(response.value.links.map((link) => link.id)).toEqual([portal.linkId])
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
  })

  it('opens the same Portal by either print code', async () => {
    const { property } = await hotel()
    const portal = await harness.seedPublishedPortal(property)

    for (const code of [portal.printCodes?.qr, portal.printCodes?.nfc]) {
      const page = await harness.callAs(null, () =>
        getPublicPortal({ data: { token: code ?? '' } }),
      )
      expect(page.reviewGateway.googleReview.status).toBe('available')
    }
  })

  it('leaves no live page for a revoked address or a replaced version', async () => {
    const { property } = await hotel()
    const revoked = await harness.seedPublishedPortal(property, { token: 'revoked' })
    const replaced = await harness.seedPublishedPortal(property, {
      name: 'Bar',
      activation: 'replaced',
    })

    for (const portal of [revoked, replaced]) {
      await expect(
        harness.callAs(null, () =>
          getPublicPortal({ data: { token: portal.rawToken ?? '' } }),
        ),
      ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
    }
  })

  it('carries the skip-private-rating switch and a changed live version', async () => {
    const { property } = await hotel()
    const portal = await harness.seedPublishedPortal(property, {
      skipPrivateRating: true,
      configuration: (base) => ({
        ...base,
        reviewGateway: { ...base.reviewGateway, privateFeedbackThreshold: 4 },
      }),
    })

    const page = await harness.callAs(null, () =>
      getPublicPortal({ data: { token: portal.rawToken ?? '' } }),
    )

    expect(page.reviewGateway).toMatchObject({
      skipPrivateRating: true,
      privateFeedbackThreshold: 4,
    })
  })
})

describe('seedPortalGroup', () => {
  it('groups the Portals the manager then lists', async () => {
    const { admin, property } = await hotel()
    const desk = await harness.seedPortal(property, { name: 'Desk' })
    const spa = await harness.seedPortal(property, { name: 'Spa' })
    const group = await harness.seedPortalGroup(property, [desk, spa], { name: 'Front' })

    const { groups } = await harness.callAs(admin, () =>
      listPortalGroups({ data: { propertyId: property.id } }),
    )

    expect(groups).toEqual([expect.objectContaining({ id: group.id, name: 'Front' })])
  })
})

describe('seedStaffParticipation', () => {
  it('makes the member a staff person who finds their own participation', async () => {
    const { organization, property } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')
    const participation = await harness.seedStaffParticipation(staff, property, {
      colleagueListEnabled: true,
    })

    const home = await harness.callAs(staff, () => getMyStaffHome())

    expect(participation.personalPortal).not.toBeNull()
    expect(home.participations).toEqual([
      expect.objectContaining({
        participationId: participation.participationId,
        colleagueListEnabled: true,
      }),
    ])
  })

  it('without a login link the member is no staff person', async () => {
    const { organization, property } = await hotel()
    const staff = await harness.seedMember(organization, 'Member')
    await harness.seedStaffParticipation(staff, property, { linkUser: false })

    await expect(harness.callAs(staff, () => getMyStaffHome())).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    })
  })
})
