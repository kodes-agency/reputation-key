import type { PortalGroupRepository } from '#/contexts/portal/application/ports/portal-group.repository'
import type { PortalLinkRepository } from '#/contexts/portal/application/ports/portal-link.repository'
import type { PortalTokenRepository } from '#/contexts/portal/application/ports/portal-token.repository'
import type {
  PortalGroup,
  PortalLinkCategory,
  PortalLink,
} from '#/contexts/portal/domain/types'
import type { PortalToken } from '#/contexts/portal/domain/portal-token'
import type {
  OrganizationId,
  PropertyId,
  PortalGroupId,
  PortalId,
  PortalLinkCategoryId,
  PortalLinkId,
} from '#/shared/domain/ids'

// In-memory command stores mutate their fakes through this test-only surface.
export type MutablePortalGroupRepository = PortalGroupRepository &
  Readonly<{
    listByProperty: (
      orgId: OrganizationId,
      propertyId: PropertyId,
    ) => Promise<ReadonlyArray<PortalGroup>>
    insert: (orgId: OrganizationId, group: PortalGroup) => Promise<void>
    update: (
      orgId: OrganizationId,
      id: PortalGroupId,
      patch: Readonly<Partial<Pick<PortalGroup, 'name' | 'sortKey' | 'updatedAt'>>>,
    ) => Promise<void>
    softDelete: (orgId: OrganizationId, id: PortalGroupId, at: Date) => Promise<void>
    removePortal: (
      orgId: OrganizationId,
      groupId: PortalGroupId,
      portalId: PortalId,
      at: Date,
      reason: string,
    ) => Promise<boolean>
  }>

export type MutablePortalLinkRepository = PortalLinkRepository &
  Readonly<{
    insertCategory: (orgId: OrganizationId, cat: PortalLinkCategory) => Promise<void>
    insertLink: (orgId: OrganizationId, link: PortalLink) => Promise<void>
    updateLink: (
      orgId: OrganizationId,
      portalId: PortalId,
      id: PortalLinkId,
      // Never the legacy `label`: a link's wording is its texts.
      patch: Readonly<Partial<Omit<PortalLink, 'label'>>>,
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
    findLinkById: (orgId: OrganizationId, id: PortalLinkId) => Promise<PortalLink | null>
  }>

export type MutablePortalTokenRepository = PortalTokenRepository &
  Readonly<{
    insert: (token: PortalToken) => Promise<void>
    saveRotation: (
      input: Readonly<{
        oldToken: PortalToken
        newToken: PortalToken
      }>,
    ) => Promise<void>
    revokeForPortal: (
      input: Readonly<{
        organizationId: OrganizationId
        portalId: PortalId
        revokedBy: string
        reason: string
        at: Date
      }>,
    ) => Promise<number>
  }>
