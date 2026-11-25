// Portal context — portal link repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { PortalLinkCategory, PortalLink } from '../domain/types'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { StoredPortalLinkText } from '../domain/portal-linktree'
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
   * primary language first.
   */
  listLinkTexts: (
    orgId: OrganizationId,
    portalId: PortalId,
    primaryLocale: GuestLocale,
  ) => Promise<ReadonlyArray<StoredPortalLinkText>>
  findCategoryById: (
    orgId: OrganizationId,
    id: PortalLinkCategoryId,
  ) => Promise<PortalLinkCategory | null>
  /** Child state and its parent revision from one database snapshot. */
  findLinkCommandTarget: (
    orgId: OrganizationId,
    id: PortalLinkId,
  ) => Promise<Readonly<{ link: PortalLink; portalUpdatedAt: Date | null }> | null>
}>
