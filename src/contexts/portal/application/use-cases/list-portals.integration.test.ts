// listPortals over the real Portal repository on real PostgreSQL, with two
// organizations.

import { describe, it, expect } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../../infrastructure/testing/portal-reads-world'
import { listPortals } from './list-portals'

const world = createPortalReadsWorld('list-portals')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portals', 'properties'],
})

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => ({
  useCase: listPortals({
    portalRepo: world.portalRepo(),
    staffPublicApi: staffApiMock(accessible),
  }),
})

describe('listPortals', () => {
  it('lists all portals for the organization', async () => {
    const { useCase } = setup()
    const p1 = world.portal({ name: 'Portal 1' })
    const p2 = world.portal({ name: 'Portal 2' })
    await world.seed([p1, p2])

    const result = await useCase({}, world.ctx())

    expect(result).toHaveLength(2)
    expect(result.map((p) => p.name)).toContain('Portal 1')
    expect(result.map((p) => p.name)).toContain('Portal 2')
  })

  it('filters portals by propertyId', async () => {
    const { useCase } = setup()
    const p1 = world.portal({ propertyId: world.propertyA })
    const p2 = world.portal({ propertyId: world.propertyB })
    await world.seed([p1, p2])

    const result = await useCase({ propertyId: world.propertyA }, world.ctx())

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(p1.id)
  })

  it('excludes soft-deleted portals', async () => {
    const { useCase } = setup()
    const p1 = world.portal()
    const p2 = world.portal({ deletedAt: new Date() })
    await world.seed([p1, p2])

    const result = await useCase({}, world.ctx())

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(p1.id)
  })

  it('excludes portals from other organizations', async () => {
    const { useCase } = setup()
    const otherOrgPortal = world.portal({ propertyId: world.propertyOfB })
    const ownPortal = world.portal()
    await world.seed([otherOrgPortal, ownPortal])

    const result = await useCase({}, world.ctx())

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(ownPortal.id)
    const theirs = await useCase({}, world.ctxB())
    expect(theirs.map((p) => p.id)).toEqual([otherOrgPortal.id])
  })

  it('scopes results to accessible properties for PropertyManager', async () => {
    const { useCase } = setup([world.propertyA])
    await world.seed([
      world.portal({ propertyId: world.propertyA }),
      world.portal({ propertyId: world.propertyB }),
    ])

    const result = await useCase({}, world.ctx({ role: 'PropertyManager' }))

    expect(result).toHaveLength(1)
    expect(result[0]?.propertyId).toBe(world.propertyA)
  })
})
