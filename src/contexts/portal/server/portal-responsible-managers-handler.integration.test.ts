// Portal responsible-manager server functions, called as signed-in members
// over PostgreSQL with the real tenant resolution and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import {
  listPortalResponsibleManagers,
  updatePortalResponsibleManagers,
} from './portal-responsible-managers'

const harness = setupServerFunctionHarness({
  cleanupTables: ['portal_responsible_managers', 'portal_responsibilities'],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  const portal = await harness.seedPortal(property)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property, portal }
}

describe('listPortalResponsibleManagers', () => {
  it("lists the Portal's eligible managers and revision to an AccountAdmin", async () => {
    const { admin, manager, portal } = await hotel()

    const listed = await harness.callAs(admin, () =>
      listPortalResponsibleManagers({ data: { portalId: portal.id } }),
    )

    expect(listed).toMatchObject({
      assignments: [],
      responsibilityNeeded: true,
      revision: expect.any(Number),
    })
    expect(listed.eligibleManagers.map((m) => m.userId)).toContain(manager.userId)
  })

  it('refuses a PropertyManager without a grant on the Portal’s Property', async () => {
    const { organization, portal } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        listPortalResponsibleManagers({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('does not find a Portal of another Organization', async () => {
    const { portal } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        listPortalResponsibleManagers({ data: { portalId: portal.id } }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found', status: 404 })
  })
})

describe('updatePortalResponsibleManagers', () => {
  it('assigns a granted manager at the expected revision', async () => {
    const { admin, manager, portal } = await hotel()
    const before = await harness.callAs(admin, () =>
      listPortalResponsibleManagers({ data: { portalId: portal.id } }),
    )

    const updated = await harness.callAs(admin, () =>
      updatePortalResponsibleManagers({
        data: {
          portalId: portal.id,
          managerUserIds: [manager.userId],
          expectedRevision: before.revision,
        },
      }),
    )

    expect(updated.revision).toBeGreaterThan(before.revision)
    expect(updated.assignments.map((a) => a.userId)).toEqual([manager.userId])
  })

  it('refuses a stale revision', async () => {
    const { admin, manager, portal } = await hotel()
    const before = await harness.callAs(admin, () =>
      listPortalResponsibleManagers({ data: { portalId: portal.id } }),
    )

    await expect(
      harness.callAs(admin, () =>
        updatePortalResponsibleManagers({
          data: {
            portalId: portal.id,
            managerUserIds: [manager.userId],
            expectedRevision: before.revision + 1,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict', status: 409 })
  })

  it('refuses a PropertyManager without a grant before changing anything', async () => {
    const { admin, organization, manager, portal } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')
    const before = await harness.callAs(admin, () =>
      listPortalResponsibleManagers({ data: { portalId: portal.id } }),
    )

    await expect(
      harness.callAs(outsider, () =>
        updatePortalResponsibleManagers({
          data: {
            portalId: portal.id,
            managerUserIds: [manager.userId],
            expectedRevision: before.revision,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })

    const after = await harness.callAs(admin, () =>
      listPortalResponsibleManagers({ data: { portalId: portal.id } }),
    )
    expect(after).toMatchObject({ assignments: [], revision: before.revision })
  })
})
