// Portal context — portal link repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { PortalLinkCategory, PortalLink } from '../../domain/types'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { ResolvedPortalLinkText } from '../../domain/portal-linktree'
import type {
  OrganizationId,
  PortalId,
  PortalLinkCategoryId,
  PortalLinkId,
} from '#/shared/domain/ids'

export type PortalLinkRepository = Readonly<{
  listCategories: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<ReadonlyArray<PortalLinkCategory>>
  listLinks: (
    orgId: OrganizationId,
    portalId: PortalId,
    categoryId: PortalLinkCategoryId,
  ) => Promise<ReadonlyArray<PortalLink>>
  listAllLinks: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<ReadonlyArray<PortalLink>>
  /**
   * Every text of every link of a Portal, in category-then-link order with the
   * primary language first. A link with no primary-language row is given its
   * legacy label as that row (`source: 'legacy_label'`), so no link is unnamed.
   */
  listLinkTexts: (
    orgId: OrganizationId,
    portalId: PortalId,
    primaryLocale: GuestLocale,
  ) => Promise<ReadonlyArray<ResolvedPortalLinkText>>
  insertCategory: (orgId: OrganizationId, cat: PortalLinkCategory) => Promise<void>
  updateCategory: (
    orgId: OrganizationId,
    portalId: PortalId,
    id: PortalLinkCategoryId,
    patch: Readonly<Partial<PortalLinkCategory>>,
  ) => Promise<void>
  deleteCategory: (
    orgId: OrganizationId,
    portalId: PortalId,
    id: PortalLinkCategoryId,
  ) => Promise<void>
  reorderCategories: (
    orgId: OrganizationId,
    portalId: PortalId,
    updates: ReadonlyArray<{ id: PortalLinkCategoryId; sortKey: string }>,
  ) => Promise<void>
  insertLink: (orgId: OrganizationId, link: PortalLink) => Promise<void>
  updateLink: (
    orgId: OrganizationId,
    portalId: PortalId,
    id: PortalLinkId,
    patch: Readonly<Partial<PortalLink>>,
  ) => Promise<void>
  deleteLink: (
    orgId: OrganizationId,
    portalId: PortalId,
    id: PortalLinkId,
  ) => Promise<void>
  reorderLinks: (
    orgId: OrganizationId,
    portalId: PortalId,
    categoryId: PortalLinkCategoryId,
    updates: ReadonlyArray<{ id: PortalLinkId; sortKey: string }>,
  ) => Promise<void>
  findCategoryById: (
    orgId: OrganizationId,
    id: PortalLinkCategoryId,
  ) => Promise<PortalLinkCategory | null>
  findLinkById: (orgId: OrganizationId, id: PortalLinkId) => Promise<PortalLink | null>
  /** Child state and its parent revision from one database snapshot. */
  findCategoryCommandTarget: (
    orgId: OrganizationId,
    id: PortalLinkCategoryId,
  ) => Promise<Readonly<{
    category: PortalLinkCategory
    portalUpdatedAt: Date | null
  }> | null>
  /** Child state and its parent revision from one database snapshot. */
  findLinkCommandTarget: (
    orgId: OrganizationId,
    id: PortalLinkId,
  ) => Promise<Readonly<{ link: PortalLink; portalUpdatedAt: Date | null }> | null>
}>
