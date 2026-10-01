// Portal context — listPortalLinks use case tests
import { describe, it, expect } from 'vitest'
import { listPortalLinks } from './list-portal-links'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
} from '#/shared/domain/ids'
import type { PortalLinkCategory, PortalLink } from '../../domain/types'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const ORG_ID = organizationId('org-00000000-0000-0000-0000-000000000001')
const PORT = portalId('a0000000-0000-4000-8000-000000000001')

const now = new Date()

const sampleCategories: ReadonlyArray<PortalLinkCategory> = [
  {
    id: portalLinkCategoryId('cat-0001'),
    portalId: PORT,
    organizationId: ORG_ID,
    title: 'Social',
    sortKey: 'a0',
    createdAt: now,
    updatedAt: now,
  },
]
const sampleLinks: ReadonlyArray<PortalLink> = [
  {
    id: portalLinkId('lnk-0001'),
    categoryId: portalLinkCategoryId('cat-0001'),
    portalId: PORT,
    organizationId: ORG_ID,
    propertyId: propertyId('a0000000-0000-4000-8000-000000000001'),
    destinationId: null,
    legacyDestinationState: 'unclassified',
    label: 'Twitter',
    url: 'https://x.com',
    sortKey: 'a0',
    iconKey: null,
    imageAssetId: null,
    createdAt: now,
    updatedAt: now,
  },
]

function setup(categories = sampleCategories, links = sampleLinks) {
  let reads = 0
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([buildTestPortal({ id: 'a0000000-0000-4000-8000-000000000001' })])
  const useCase = listPortalLinks({
    portalLinkRepo: {
      listCategories: async () => {
        reads += 1
        return categories
      },
      listAllLinks: async () => links,
      listLinks: async () => [],
      listLinkTexts: async () => [],
      insertCategory: async () => {},
      insertLink: async () => {},
      updateLink: async () => {},
      deleteLink: async () => {},
      reorderLinks: async () => {},
      findCategoryById: async () => null,
      findLinkById: async () => null,
      findLinkCommandTarget: async () => null,
    },
    portalRepo,
    staffPublicApi: staffApiMock(null),
  })
  return { useCase, categoryReads: () => reads }
}

describe('listPortalLinks (use case)', () => {
  it('returns the links of a portal for a PropertyManager, and reads no categories', async () => {
    const { useCase, categoryReads } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(result).toEqual({ links: sampleLinks })
    expect(categoryReads()).toBe(0)
  })

  it('returns no links when the portal has none', async () => {
    const { useCase } = setup([], [])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(result.links).toHaveLength(0)
  })
})
