// Property context — public API surface for cross-context consumers.
// Other contexts (team, portal, integration) consume this typed interface
// to query property data. Per ADR-0001.

import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'

/** Minimal property info returned for cross-context lookups (e.g., webhook resolution). */
export type PropertyLookupResult = Readonly<{
  id: string
  organizationId: string
  googleConnectionId: string | null
}>

export { propertyCreated } from '../domain/events'
export type { PropertyCreated } from '../domain/events'

export type PropertyPublicApi = Readonly<{
  /**
   * Check whether a property exists within an organization.
   */
  propertyExists: (orgId: OrganizationId, propertyId: PropertyId) => Promise<boolean>

  /**
   * Find a non-deleted property by its Google Business Profile place ID.
   * Used by the integration context for GBP webhook handling (push-based,
   * no organizationId available at call time).
   */
  findByGbpPlaceId: (gbpPlaceId: string) => Promise<PropertyLookupResult | null>

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
}>
