// Portal context — listPortalGroups use case tests
import { describe, it, expect } from 'vitest'
import { listPortalGroups } from './list-portal-groups'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, portalGroupId, propertyId } from '#/shared/domain/ids'
import type { PortalGroup } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')

const sampleGroups: ReadonlyArray<PortalGroup> = [
  {
    id: portalGroupId('g1'),
    organizationId: ORG,
    propertyId: PROP,
    name: 'Group A',
    sortKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  },
  {
    id: portalGroupId('g2'),
    organizationId: ORG,
    propertyId: PROP,
    name: 'Group B',
    sortKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  },
]

function setup(
  groups = sampleGroups,
  accessible: ReadonlyArray<PropertyId> | null = null,
) {
  const useCase = listPortalGroups({
    portalGroupRepo: {
      listByProperty: async () => groups,
      findById: async () => null,
      nameExists: async () => false,
      insert: async () => {},
      update: async () => {},
      softDelete: async () => {},
      addPortal: async () => {},
      removePortal: async () => false,
      findPortalMembership: async () => null,
      getGroupPortalIds: async () => [],
      findGroupForPortal: async () => null,
    },
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase }
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
