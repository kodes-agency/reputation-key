// Portal context — portal link repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { PortalLinkCategory, PortalLink } from '../../domain/types'
import type { OrganizationId, PortalId, PortalLinkCategoryId, PortalLinkId } from '#/shared/domain/ids'

export type PortalLinkRepository = Readonly<{
  listCategories: (orgId: OrganizationId, portalId: PortalId) => Promise<ReadonlyArray<PortalLinkCategory>>
  listLinks: (orgId: OrganizationId, categoryId: PortalLinkCategoryId) => Promise<ReadonlyArray<PortalLink>>
  listAllLinks: (orgId: OrganizationId, portalId: PortalId) => Promise<ReadonlyArray<PortalLink>>
  insertCategory: (orgId: OrganizationId, cat: PortalLinkCategory) => Promise<void>
  updateCategory: (
    orgId: OrganizationId,
    id: PortalLinkCategoryId,
    patch: Readonly<Partial<PortalLinkCategory>>,
  ) => Promise<void>
  deleteCategory: (orgId: OrganizationId, id: PortalLinkCategoryId) => Promise<void>
  reorderCategories: (
    orgId: OrganizationId,
    updates: ReadonlyArray<{ id: PortalLinkCategoryId; sortKey: string }>,
  ) => Promise<void>
  insertLink: (orgId: OrganizationId, link: PortalLink) => Promise<void>
  updateLink: (orgId: OrganizationId, id: PortalLinkId, patch: Readonly<Partial<PortalLink>>) => Promise<void>
  deleteLink: (orgId: OrganizationId, id: PortalLinkId) => Promise<void>
  reorderLinks: (orgId: OrganizationId, updates: ReadonlyArray<{ id: PortalLinkId; sortKey: string }>) => Promise<void>
  findCategoryById: (orgId: OrganizationId, id: PortalLinkCategoryId) => Promise<PortalLinkCategory | null>
  findLinkById: (orgId: OrganizationId, id: PortalLinkId) => Promise<PortalLink | null>
}>
