// Portal context — listPortalGroups use case tests
import { describe, it, expect, vi } from 'vitest'
import { listPortalGroups } from './list-portal-groups'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { PortalGroupWithPortals } from './list-portal-groups'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')

const sampleGroups: ReadonlyArray<PortalGroupWithPortals> = [
  {
    id: portalGroupId('g1'),
    organizationId: ORG,
    propertyId: PROP,
    name: 'Group A',
    sortKey: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    portalIds: [portalId('p1'), portalId('p2')],
  },
  {
    id: portalGroupId('g2'),
    organizationId: ORG,
    propertyId: PROP,
    name: 'Group B',
    sortKey: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    portalIds: [],
  },
]

function setup(
  groups = sampleGroups,
  accessible: ReadonlyArray<PropertyId> | null = null,
) {
  const listPortalGroupsWithPortals = vi.fn(async () => groups)
  const useCase = listPortalGroups({
    portalGroupRepo: {
      listByProperty: async () => [],
      findById: async () => null,
      nameExists: async () => false,
      insert: async () => {},
      update: async () => {},
      softDelete: async () => {},
      addPortal: async () => {},
      removePortal: async () => false,
      findPortalMembership: async () => null,
      getGroupPortalIds: async () => [],
      findGroupIdsByPortalIds: async () => [],
      listGroupsForPortals: async () => [],
      listPortalGroupsWithPortals,
      findGroupForPortal: async () => null,
    },
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, listPortalGroupsWithPortals }
}

describe('listPortalGroups (use case)', () => {
  it('returns groups for property with PropertyManager role', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { propertyId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Group A')
  })

  it('reads the groups and their Portals in one call, not one per group', async () => {
    const { useCase, listPortalGroupsWithPortals } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { propertyId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(listPortalGroupsWithPortals).toHaveBeenCalledTimes(1)
    expect(listPortalGroupsWithPortals).toHaveBeenCalledWith(ctx.organizationId, PROP)
    expect(result.map((group) => group.portalIds)).toEqual([
      [portalId('p1'), portalId('p2')],
      [],
    ])
  })

  it('returns empty array when no groups exist', async () => {
    const { useCase } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { propertyId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(result).toHaveLength(0)
  })

  it('scopes groups to accessible properties for PropertyManager', async () => {
    const propB = propertyId('b0000000-0000-0000-0000-000000000002')
    const groupsOnPropB = [{ ...sampleGroups[0], propertyId: propB }]
    const { useCase } = setup(groupsOnPropB, [
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { propertyId: 'b0000000-0000-0000-0000-000000000002' },
      ctx,
    )

    expect(result).toHaveLength(0)
  })
})
