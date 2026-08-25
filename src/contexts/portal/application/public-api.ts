/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports ports for cross-context dependency injection.
 */
export type { StoragePort } from './ports/storage.port'
export type { LinkResolverPort } from './ports/link-resolver.port'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events.
export type {
  PortalApprovedDestinationRatioRecorded,
  PortalConfigurationCompletenessRecorded,
  PortalContentReviewCompleted,
  PortalDeleted,
  PortalResponsibilityNeeded,
  PortalEvent,
  PortalGroupDeleted,
} from '../domain/events'

export { isValidExternalUrl } from '../domain/rules'
export type { Portal } from '../domain/types'
/** C2: portal token existence/metadata for management surfaces — never token material. */
export type { PortalTokenStatus } from './use-cases/get-portal'

import type {
  OrganizationId,
  PropertyId,
  PortalId,
  PortalGroupId,
} from '#/shared/domain/ids'

/** Result of resolving a portal's context (org + property) by portal ID. */
export type PortalContextResult = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

/** Full public portal data returned for guest-facing token lookups. */
export type PublicPortalResult = Readonly<{
  portal: {
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null

    organizationName: string
  }
  categories: ReadonlyArray<{ id: string; title: string; sortKey: string }>
  links: ReadonlyArray<{
    id: string
    label: string
    url: string
    categoryId: string | null
    sortKey: string
  }>
  organizationId: string
  propertyId: string
}>

export type PublicPortalByTokenOutcome =
  | Readonly<{ status: 'found'; result: PublicPortalResult }>
  | Readonly<{ status: 'unavailable' }>

/** Portal context public API — consumed by guest and other contexts. */
export type PortalPublicApi = Readonly<{
  /**
   * Resolve the org + property a portal belongs to, by portal ID.
   * No organizationId scoping — the portal ID acts as a capability token
   * for unauthenticated guest requests.
   */
  resolvePortalContext: (portalId: PortalId) => Promise<PortalContextResult | null>

  /**
   * Get minimal portal info (id, name, isActive) by org + portal ID.
   * Used by staff context to resolve assigned portal details.
   */
  getPortalInfo: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<Readonly<{
    id: PortalId
    name: string
    publicationState: 'draft' | 'published' | 'disabled' | 'archived'
  }> | null>

  /**
   * Resolve a full public portal through a revocable opaque capability token.
   * Every unavailable posture deliberately collapses to one outcome.
   */
  findPublicPortalByToken: (rawToken: string) => Promise<PublicPortalByTokenOutcome>
  /** Current assigned managers, revalidated against role/access/participation. */
  getResponsibleManagerUserIds: (
    orgId: OrganizationId,
    portalId: PortalId,
  ) => Promise<ReadonlyArray<import('#/shared/domain/ids').UserId>>
}>

/** Minimal portal group info for cross-context consumers. */
export type PortalGroupSummary = Readonly<{
  id: PortalGroupId
  propertyId: PropertyId
  name: string
}>

/** Portal group public API — consumed by other contexts for cross-context queries. */
export type PortalGroupPublicApi = Readonly<{
  findGroupForPortal: (
    orgId: OrganizationId,
    portalId: PortalId,
    asOf?: Date,
  ) => Promise<PortalGroupSummary | null>
  getGroupPortalIds: (
    orgId: OrganizationId,
    groupId: PortalGroupId,
  ) => Promise<ReadonlyArray<PortalId>>
  /** Given portal IDs, return the distinct group IDs those portals belong to. */
  findGroupIdsByPortalIds: (
    orgId: OrganizationId,
    portalIds: ReadonlyArray<PortalId>,
  ) => Promise<ReadonlyArray<PortalGroupId>>
  portalGroupBelongsToProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    groupId: PortalGroupId,
  ) => Promise<boolean>
}>
