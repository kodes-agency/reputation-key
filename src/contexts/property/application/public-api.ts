// Property context — public API surface for cross-context consumers.
// Other contexts (team, portal, integration) consume this typed interface
// to query property data. Per ADR-0001.

import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'

/** Minimal property info returned for cross-context slug lookups (e.g., guest portal resolution). */
export type PropertySlugLookupResult = Readonly<{
  id: string
  organizationId: string
}>

/** Minimal property info returned for cross-context lookups (e.g., webhook resolution). */
export type PropertyLookupResult = Readonly<{
  id: string
  organizationId: string
  googleConnectionId: string | null
}>

/** Result of a property import (GBP bulk import). */
export type PropertyImportResult = Readonly<{
  id: string
  organizationId: string
  name: string
  slug: string
  gbpPlaceId: string | null
  createdAt: Date | null
}>

/** Thrown by importProperty when a unique-constraint violation occurs (e.g. duplicate gbpPlaceId). */
export type PropertyImportConflict = Readonly<{
  _tag: 'PropertyImportConflict'
  message: string
}>

export const propertyImportConflict = (message: string): PropertyImportConflict => ({
  _tag: 'PropertyImportConflict',
  message,
})

export const isPropertyImportConflict = (e: unknown): e is PropertyImportConflict =>
  typeof e === 'object' &&
  e !== null &&
  (e as PropertyImportConflict)._tag === 'PropertyImportConflict'

export { propertyCreated } from '../domain/events'
export type { PropertyCreated } from '../domain/events'

export type PropertyPublicApi = Readonly<{
  /**
   * Check whether a property exists within an organization.
   */
  propertyExists: (orgId: OrganizationId, propertyId: PropertyId) => Promise<boolean>

  /**
   * Get a property's display name by ID. Returns null if not found or deleted.
   * Used by cross-context lookup ports (e.g., inbox enrichment).
   */
  getPropertyName: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>

  /**
   * Get display names for multiple properties by IDs. Returns array of { id, name }.
   * Used by cross-context batch lookup ports (e.g., inbox enrichment N+1 fix).
   */
  getPropertyNames: (
    orgId: OrganizationId,
    propertyIds: ReadonlyArray<PropertyId>,
  ) => Promise<ReadonlyArray<{ id: string; name: string | null }>>

  /**
   * Find a non-deleted property by its Google Business Profile place ID.
   * Used by the integration context for GBP webhook handling (push-based,
   * no organizationId available at call time).
   */
  findByGbpPlaceId: (gbpPlaceId: string) => Promise<PropertyLookupResult | null>

  /**
   * Find a non-deleted property by its slug.
   * No organizationId — the slug is public-facing, used for guest portal resolution.
   */
  findBySlug: (slug: string) => Promise<PropertySlugLookupResult | null>

  /**
   * Find all non-deleted property IDs linked to a Google connection within an org.
   * Used by integration context for GBP cache and connection cleanup.
   */
  findIdsByGoogleConnection: (
    connectionId: GoogleConnectionId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<string>>

  /**
   * Null out all googleConnectionId references for a given connection.
   * Used by integration context when disconnecting a Google account.
   */
  clearGoogleConnectionRef: (
    orgId: OrganizationId,
    connectionId: GoogleConnectionId,
  ) => Promise<void>

  /**
   * Import a property during GBP bulk import. Creates a new property row.
   * Throws PropertyImportConflict on unique-constraint violations (e.g. duplicate gbpPlaceId).
   */
  importProperty: (input: {
    orgId: OrganizationId
    name: string
    slug: string
    gbpPlaceId: string
    googleConnectionId: GoogleConnectionId
  }) => Promise<PropertyImportResult>

  /**
   * Find existing non-deleted property gbpPlaceIds for the given organization.
   * Used by integration context to skip already-imported GBP locations.
   */
  findExistingGbpPlaceIds: (
    orgId: OrganizationId,
    gbpPlaceIds: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<string>>

  /**
   * Check if a property with this gbpPlaceId exists (for race-condition recovery).
   * Used by integration context during GBP import error handling.
   */
  existsByGbpPlaceId: (orgId: OrganizationId, gbpPlaceId: string) => Promise<boolean>
}>
