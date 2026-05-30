// Portal context — listPortalGroups use case tests
import { describe, it, expect } from 'vitest'
import { listPortalGroups } from './list-portal-groups'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { organizationId, portalGroupId, propertyId } from '#/shared/domain/ids'
import type { PortalGroup } from '../../domain/types'

const ORG = organizationId('org-00000000-0000-0000-0000-000000000001')
const PROP = propertyId('a0000000-0000-4000-8000-000000000001')

const sampleGroups: ReadonlyArray<PortalGroup> = [
  { id: portalGroupId('g1'), organizationId: ORG, propertyId: PROP, name: 'Group A', createdAt: new Date(), updatedAt: new Date() },
  { id: portalGroupId('g2'), organizationId: ORG, propertyId: PROP, name: 'Group B', createdAt: new Date(), updatedAt: new Date() },
]

function setup(groups: ReadonlyArray<PortalGroup> = sampleGroups) {
  const useCase = listPortalGroups({
    groupRepo: {
      listByProperty: async () => groups,
      findById: async () => null,
      findByNameDuplicate: async () => null,
      insert: async (g) => g,
      update: async (g) => g,
      delete: async () => {},
    },
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
})
