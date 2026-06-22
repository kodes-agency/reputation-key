// Portal context — list portals use case tests

import { describe, it, expect } from 'vitest'
import { listPortals } from './list-portals'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const useCase = listPortals({ portalRepo, staffPublicApi: staffApiMock(accessible) })
  return { useCase, portalRepo }
}

describe('listPortals', () => {
  it('lists all portals for the organization', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const p1 = buildTestPortal({ id: 'p1', name: 'Portal 1' })
    const p2 = buildTestPortal({ id: 'p2', name: 'Portal 2' })
    portalRepo.seed([p1, p2])

    const result = await useCase({}, ctx)

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.name)).toContain('Portal 1')
    expect(result.map((p) => p.name)).toContain('Portal 2')
  })

  it('filters portals by propertyId', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const propA = propertyId('a0000000-0000-0000-0000-000000000001')
    const propB = propertyId('b0000000-0000-0000-0000-000000000001')
    const p1 = buildTestPortal({ id: 'p1', propertyId: propA })
    const p2 = buildTestPortal({ id: 'p2', propertyId: propB })
    portalRepo.seed([p1, p2])

    const result = await useCase({ propertyId: propA }, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(p1.id)
  })

  it('excludes soft-deleted portals', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const p1 = buildTestPortal({ id: 'p1' })
    const p2 = buildTestPortal({ id: 'p2', deletedAt: new Date() })
    portalRepo.seed([p1, p2])

    const result = await useCase({}, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(p1.id)
  })

  it('excludes portals from other organizations', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext()
    const otherOrgPortal = buildTestPortal({
      id: 'p-other',
      organizationId:
        'org-00000000-0000-0000-0000-000000000002' as unknown as import('#/shared/domain/ids').OrganizationId,
    })
    const ownPortal = buildTestPortal({ id: 'p-own' })
    portalRepo.seed([otherOrgPortal, ownPortal])

    const result = await useCase({}, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(ownPortal.id)
  })

  it('scopes results to accessible properties for PropertyManager', async () => {
    const propA = propertyId('a0000000-0000-0000-0000-000000000001')
    const propB = propertyId('b0000000-0000-0000-0000-000000000002')
    const { useCase, portalRepo } = setup([propA])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    portalRepo.seed([
      buildTestPortal({ id: 'p1', propertyId: propA }),
      buildTestPortal({ id: 'p2', propertyId: propB }),
    ])

    const result = await useCase({}, ctx)

    expect(result).toHaveLength(1)
    expect(result[0].propertyId).toBe(propA)
  })
})
