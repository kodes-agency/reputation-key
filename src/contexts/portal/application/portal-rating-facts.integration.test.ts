import { describe, expect, it, vi } from 'vitest'
import { createPortalRatingFacts } from './portal-rating-facts'
import { portalGroupId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPortalReadsWorld } from '../infrastructure/testing/portal-reads-world'

const world = createPortalReadsWorld('rating-facts')

setupIntegrationDb({
  orgA: world.orgA,
  orgB: world.orgB,
  tables: ['portals', 'properties'],
})

describe('scoped Portal rating facts', () => {
  const portals = Array.from({ length: 101 }, (_, i) =>
    world.portal({ skipPrivateRating: i !== 100 }),
  )
  const target = portals[100]!
  const group = {
    id: portalGroupId('90000000-0000-4000-8000-000000000001'),
    organizationId: target.organizationId,
    propertyId: target.propertyId,
    name: 'Group',
    sortKey: null,
    createdBy: null,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
    deletedAt: null,
  }
  const setup = async () => {
    await world.seed(portals)
    const portalRepo = world.portalRepo()
    const listByProperty = vi.spyOn(portalRepo, 'listByProperty')
    const groupRepo = {
      findById: vi.fn(async () => group),
      getGroupPortalIds: vi.fn(async () => portals.map((p) => p.id)),
    }
    return {
      ...createPortalRatingFacts({ portalRepo, portalGroupRepo: groupRepo }),
      listByProperty,
      groupRepo,
    }
  }
  it('reads a single Portal beyond the first hundred without loading the Property', async () => {
    const facts = await setup()
    expect(
      await facts.listPortalRatingFacts(target.organizationId, target.propertyId, {
        kind: 'portal',
        portalId: target.id,
      }),
    ).toEqual([
      {
        portalId: target.id,
        portalGroupId: null,
        publicationState: 'published',
        skipPrivateRating: false,
      },
    ])
    expect(facts.listByProperty).not.toHaveBeenCalled()
  })
  it('includes every Group member beyond one hundred without a Property-wide read', async () => {
    const facts = await setup()
    const result = await facts.listPortalRatingFacts(
      target.organizationId,
      target.propertyId,
      { kind: 'portal_group', portalGroupId: group.id },
    )
    expect(result).toHaveLength(101)
    expect(result.at(-1)?.skipPrivateRating).toBe(false)
    expect(facts.listByProperty).not.toHaveBeenCalled()
  })
  it('reads all Property candidates without a cap', async () => {
    const facts = await setup()
    expect(
      await facts.listPortalRatingFacts(target.organizationId, target.propertyId, {
        kind: 'property',
        propertyId: target.propertyId,
      }),
    ).toHaveLength(101)
  })
  it('reads nothing of another organization’s Portals', async () => {
    const facts = await setup()
    expect(
      await facts.listPortalRatingFacts(world.orgB, target.propertyId, {
        kind: 'portal',
        portalId: target.id,
      }),
    ).toEqual([])
    expect(
      await facts.listPortalRatingFacts(world.orgB, target.propertyId, {
        kind: 'property',
        propertyId: target.propertyId,
      }),
    ).toEqual([])
  })
})
