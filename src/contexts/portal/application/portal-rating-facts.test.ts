import { describe, expect, it, vi } from 'vitest'
import { createPortalRatingFacts } from './portal-rating-facts'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { portalGroupId } from '#/shared/domain/ids'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'

describe('scoped Portal rating facts', () => {
  const portals = Array.from({ length: 101 }, (_, i) =>
    buildTestPortal({ id: 'portal-' + i, skipPrivateRating: i !== 100 }),
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
  const setup = () => {
    const portalRepo = createInMemoryPortalRepo()
    portalRepo.seed(portals)
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
    const facts = setup()
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
    const facts = setup()
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
    const facts = setup()
    expect(
      await facts.listPortalRatingFacts(target.organizationId, target.propertyId, {
        kind: 'property',
        propertyId: target.propertyId,
      }),
    ).toHaveLength(101)
  })
})
