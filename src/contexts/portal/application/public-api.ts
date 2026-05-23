/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports ports for cross-context dependency injection.
 */
export type { StoragePort } from './ports/storage.port'
export type { LinkResolverPort } from './ports/link-resolver.port'

// Event re-exports — cross-context consumers must import events from public-api, not domain/events
export type { PortalDeleted, PortalEvent } from '../domain/events'
export { portalDeleted } from '../domain/events'

import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

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

/** Portal context public API — consumed by guest and other contexts. */
export type PortalPublicApi = Readonly<{
  /**
   * Resolve the org + property a portal belongs to, by portal ID.
   * No organizationId scoping — the portal ID acts as a capability token
   * for unauthenticated guest requests.
   */
  resolvePortalContext: (portalId: PortalId) => Promise<PortalContextResult | null>

  /**
   * Full public portal lookup by property slug + portal slug.
   * Returns portal info, link categories, links, and org name.
   * Used by guest context for the public-facing portal page.
   */
  findPublicPortalBySlug: (
    propertySlug: string,
    portalSlug: string,
  ) => Promise<PublicPortalBySlugResult | null>
}>
