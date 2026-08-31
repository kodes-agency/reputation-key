import { describe, expect, it, vi } from 'vitest'
import { listStaffPortals } from './list-staff-portals'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { StaffPortalLookupPort } from '../ports/portal-lookup.port'
import type { PortalResponsibilityLookupPort } from '../ports/portal-responsibility-lookup.port'
import { portalId, propertyId, userId } from '#/shared/domain/ids'
import type { PortalId, PropertyId, UserId } from '#/shared/domain/ids'

const TARGET_USER = userId('user-00000000-0000-0000-0000-0000000000aa') as UserId
const TARGET_PROPERTY = propertyId('a0000000-0000-0000-0000-0000000000a1') as PropertyId

const createFakePortalLookup = (
  portals: Readonly<Record<string, { name: string; isActive: boolean }>>,
): StaffPortalLookupPort => ({
  listPortalIdsByProperty: async () => [],
  getPortalInfo: async (_orgId, id: PortalId) => {
    const entry = portals[String(id)]
    if (!entry) return null
    return {
      id,
      name: entry.name,
      publicationState: entry.isActive ? 'published' : 'disabled',
    }
  },
})

function setup(
  assignedPortalIds: ReadonlyArray<PortalId> = [],
  portals: Readonly<Record<string, { name: string; isActive: boolean }>> = {},
) {
  const responsibilityLookup: PortalResponsibilityLookupPort = {
    listAssignedPortalIds: vi.fn(async () => assignedPortalIds),
  }
  const portalLookup = createFakePortalLookup(portals)
  return {
    useCase: listStaffPortals({ responsibilityLookup, portalLookup }),
    responsibilityLookup,
  }
}

describe('listStaffPortals', () => {
  it('resolves portals from current Portal Responsibility', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const assignedPortal = portalId('p-00000000-0000-0000-0000-000000000000') as PortalId
    const { useCase, responsibilityLookup } = setup([assignedPortal], {
      [String(assignedPortal)]: { name: 'Responsible Portal', isActive: true },
    })

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )

    expect(responsibilityLookup.listAssignedPortalIds).toHaveBeenCalledWith(
      ctx.organizationId,
      TARGET_USER,
      TARGET_PROPERTY,
    )
    expect(result.portals).toEqual([{ id: assignedPortal, name: 'Responsible Portal' }])
  })

  it('deduplicates reconciled responsibility rows', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const assignedPortal = portalId('p-00000000-0000-0000-0000-000000000001') as PortalId
    const { useCase } = setup([assignedPortal, assignedPortal], {
      [String(assignedPortal)]: { name: 'Only Portal', isActive: true },
    })

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )

    expect(result.portals).toEqual([{ id: assignedPortal, name: 'Only Portal' }])
  })

  it('excludes unpublished portals', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const published = portalId('p-00000000-0000-0000-0000-000000000020') as PortalId
    const disabled = portalId('p-00000000-0000-0000-0000-000000000021') as PortalId
    const { useCase } = setup([published, disabled], {
      [String(published)]: { name: 'Published', isActive: true },
      [String(disabled)]: { name: 'Disabled', isActive: false },
    })

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )

    expect(result.portals).toEqual([{ id: published, name: 'Published' }])
  })

  it('sorts portals alphabetically by name', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const zeta = portalId('p-00000000-0000-0000-0000-000000000030') as PortalId
    const alpha = portalId('p-00000000-0000-0000-0000-000000000031') as PortalId
    const middle = portalId('p-00000000-0000-0000-0000-000000000032') as PortalId
    const { useCase } = setup([zeta, alpha, middle], {
      [String(zeta)]: { name: 'Zeta Portal', isActive: true },
      [String(alpha)]: { name: 'Alpha Portal', isActive: true },
      [String(middle)]: { name: 'Middle Portal', isActive: true },
    })

    const result = await useCase(
      { userId: TARGET_USER, propertyId: TARGET_PROPERTY },
      ctx,
    )

    expect(result.portals.map((portal) => portal.name)).toEqual([
      'Alpha Portal',
      'Middle Portal',
      'Zeta Portal',
    ])
  })

  it('returns an empty list when no current responsibility exists', async () => {
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const { useCase } = setup()

    await expect(
      useCase({ userId: TARGET_USER, propertyId: TARGET_PROPERTY }, ctx),
    ).resolves.toEqual({ portals: [] })
  })
})
