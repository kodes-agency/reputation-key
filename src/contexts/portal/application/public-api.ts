/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports ports for cross-context dependency injection.
 */
export type { StoragePort } from './ports/storage.port'
export type { LinkResolverPort } from './ports/link-resolver.port'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { PortalDeleted, PortalEvent } from '../domain/events'

export type { PortalGroupDeleted } from '../domain/events'

export { isValidExternalUrl } from '../domain/rules'

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

/** Full public portal data returned for guest-facing lookups by slug. */
export type PublicPortalBySlugResult = Readonly<{
  portal: {
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
    smartRoutingEnabled: boolean
    smartRoutingThreshold: number
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

/**
 * BQC-5.6: typed outcome for the public slug lookup — cross-context
 * consumers switch on `status` instead of catching portal domain errors
 * (review eligible-reads precedent). `inactive` maps the repository's
 * portalError('portal_inactive'); `not_found` maps its null; any other
 * error is rethrown unchanged.
 */
export type PublicPortalBySlugOutcome =
  | Readonly<{ status: 'found'; result: PublicPortalBySlugResult }>
  | Readonly<{ status: 'inactive' }>
  | Readonly<{ status: 'not_found' }>

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
  ) => Promise<Readonly<{ id: PortalId; name: string; isActive: boolean }> | null>

  /**
   * Full public portal lookup by property slug + portal slug.
   * Returns a typed outcome: found (portal info, link categories, links,
   * org name), inactive, or not_found. Used by guest context for the
   * public-facing portal page.
   */
  findPublicPortalBySlug: (
    propertySlug: string,
    portalSlug: string,
  ) => Promise<PublicPortalBySlugOutcome>
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
}>
