// Portal context — listPortalLinks use case tests
import { describe, it, expect } from 'vitest'
import { listPortalLinks } from './list-portal-links'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
} from '#/shared/domain/ids'
import type { PortalLinkCategory, PortalLink } from '../../domain/types'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
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
    label: 'Twitter',
    url: 'https://x.com',
    sortKey: 'a0',
    iconKey: null,
    createdAt: now,
    updatedAt: now,
  },
]

function setup(categories = sampleCategories, links = sampleLinks) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([buildTestPortal({ id: 'a0000000-0000-4000-8000-000000000001' })])
  const useCase = listPortalLinks({
    portalLinkRepo: {
      listCategories: async () => categories,
      listAllLinks: async () => links,
      listLinks: async () => [],
      insertCategory: async () => {},
      updateCategory: async () => {},
      deleteCategory: async () => {},
      reorderCategories: async () => {},
      insertLink: async () => {},
      updateLink: async () => {},
      deleteLink: async () => {},
      reorderLinks: async () => {},
      findCategoryById: async () => null,
      findLinkById: async () => null,
    },
    portalRepo,
    staffPublicApi: staffApiMock(null),
  })
  return { useCase }
}

describe('listPortalLinks (use case)', () => {
  it('returns categories and links for portal with PropertyManager', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(result.categories).toHaveLength(1)
    expect(result.links).toHaveLength(1)
    expect(result.categories[0].title).toBe('Social')
  })

  it('returns empty arrays when portal has no links', async () => {
    const { useCase } = setup([], [])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { portalId: 'a0000000-0000-4000-8000-000000000001' },
      ctx,
    )

    expect(result.categories).toHaveLength(0)
    expect(result.links).toHaveLength(0)
  })
})
