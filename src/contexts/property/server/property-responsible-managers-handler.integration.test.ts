// Property responsible-manager server functions, called as signed-in members
// over PostgreSQL with the real tenant resolution and execution policy.

import { describe, expect, it, vi } from 'vitest'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)
import {
  listPropertyResponsibleManagers,
  updatePropertyResponsibleManagers,
} from './property-responsible-managers'

const harness = setupServerFunctionHarness({
  cleanupTables: ['property_responsible_managers'],
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const property = await harness.seedProperty(organization)
  await harness.grantProperty(manager, property)
  return { organization, admin, manager, property }
}

describe('listPropertyResponsibleManagers', () => {
  it('lists the eligible managers and the revision to an AccountAdmin', async () => {
    const { admin, manager, property } = await hotel()

    const listed = await harness.callAs(admin, () =>
      listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
    )

    expect(listed).toMatchObject({
      assignments: [],
      responsibilityNeeded: true,
      revision: expect.any(Number),
    })
    expect(listed.eligibleManagers.map((m) => m.userId)).toContain(manager.userId)
  })

  it('lists to a PropertyManager the Property was granted to', async () => {
    const { manager, property } = await hotel()

    const listed = await harness.callAs(manager, () =>
      listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
    )

    expect(listed.assignments).toEqual([])
  })

  it('refuses a PropertyManager the Property was not granted to', async () => {
    const { organization, property } = await hotel()
    const outsider = await harness.seedMember(organization, 'PropertyManager')

    await expect(
      harness.callAs(outsider, () =>
        listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied', status: 403 })
  })

  it('refuses a member whose role has no beta manager access', async () => {
    const { organization, property } = await hotel()
    const member = await harness.seedMember(organization, 'Member')

    await expect(
      harness.callAs(member, () =>
        listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'beta_role_inactive' })
  })

  it('does not find the Property for an AccountAdmin of another Organization', async () => {
    const { property } = await hotel()
    const elsewhere = await harness.seedOrganization()
    const otherAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')

    await expect(
      harness.callAs(otherAdmin, () =>
        listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'property_not_found', status: 404 })
  })

  it('refuses a caller with no session', async () => {
    const { property } = await hotel()

    await expect(
      harness.callAs(null, () =>
        listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', status: 401 })
  })

  it('refuses a Property id that is not a UUID before reading anything', async () => {
    const { admin } = await hotel()

    await expect(
      harness.callAs(admin, () =>
        listPropertyResponsibleManagers({ data: { propertyId: 'property-1' } }),
      ),
    ).rejects.toThrow(/propertyId/)
  })
})

describe('updatePropertyResponsibleManagers', () => {
  it('assigns the chosen manager at the expected revision', async () => {
    const { admin, manager, property } = await hotel()
    const before = await harness.callAs(admin, () =>
      listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
    )

    await harness.callAs(admin, () =>
      updatePropertyResponsibleManagers({
        data: {
          propertyId: property.id,
          managerUserIds: [manager.userId],
          expectedRevision: before.revision,
        },
      }),
    )

    const after = await harness.callAs(admin, () =>
      listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
    )
    expect(after.assignments.map((a) => a.userId)).toEqual([manager.userId])
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(after.responsibilityNeeded).toBe(false)
  })

  it('refuses a stale revision and leaves the assignments alone', async () => {
    const { admin, manager, property } = await hotel()
    const before = await harness.callAs(admin, () =>
      listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
    )

    await expect(
      harness.callAs(admin, () =>
        updatePropertyResponsibleManagers({
          data: {
            propertyId: property.id,
            managerUserIds: [manager.userId],
            expectedRevision: before.revision + 1,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict', status: 409 })

    const after = await harness.callAs(admin, () =>
      listPropertyResponsibleManagers({ data: { propertyId: property.id } }),
    )
    expect(after.assignments).toEqual([])
  })
})
