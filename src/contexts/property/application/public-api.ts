// Property context — public API surface for cross-context consumers.
// Other contexts (portal, integration) consume this typed interface
// to query property data. Per ADR-0001.

import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { PropertyGoogleBindingStore } from './ports/property-google-binding.port'
export { buildGoogleImportedProperty } from './build-google-imported-property'
export type {
  PropertyArchived,
  PropertyCreated,
  PropertyDeleted,
  PropertyRestored,
  PropertyUpdated,
  PropertyResponsibilityNeeded,
} from '../domain/events'

/** Minimal property info returned for cross-context lookups (e.g., webhook resolution). */
type PropertyLookupResult = Readonly<{
  id: string
  organizationId: string
  googleConnectionId: string | null
  gbpAccountId: string | null
  gbpLocationId: string | null
  googleBindingState:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  sourceEpoch: number
}>

/** Content-free property facts for governed cross-context workflows. */
export type PropertyFactsPublicApi = Readonly<{
  getPropertyTimezone: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
}>

/** Current binding generation read from one Property snapshot. */
export type PropertySourceEpochPublicApi = Readonly<{
  getSourceEpoch: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<Readonly<{ sourceEpoch: number }> | null>
}>

/** Server-only binding lifecycle API. Provider identifiers never enter browser DTOs. */
export type PropertyGoogleBindingPublicApi = PropertyGoogleBindingStore

export type PropertyGoogleReviewDestinationPublicApi = Readonly<{
  /** Safe Property-owned snapshot. A non-verified URI must never be rendered. */
  getGoogleReviewDestination: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<
    import('../domain/google-review-destination').PropertyGoogleReviewDestination | null
  >
}>

/** Fail-closed current lifecycle authority for public and external-effect gates. */
export type PropertyLifecyclePublicApi = Readonly<{
  isPropertyActive: (orgId: OrganizationId, propertyId: PropertyId) => Promise<boolean>
}>

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
   * Find a non-deleted property by its Google Business Profile location ID.
   * Used by the integration context for GBP webhook handling (push-based,
   * no organizationId available at call time).
   */
  findByGbpLocationId: (gbpLocationId: string) => Promise<PropertyLookupResult | null>

  /**
   * Find all non-deleted property IDs linked to a Google connection within an org.
   * Used by Integration connection lifecycle handling.
   */
  findIdsByGoogleConnection: (
    connectionId: GoogleConnectionId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<string>>

  /**
   * Stable Property scope used only to persist/deliver an Organization-level
   * Google connection notice. Prefers an affected linked Property, then the
   * first active Property in the Organization. Null only when the Organization
   * has no Property rows at all.
   */
  findGoogleNotificationAnchor: (
    connectionId: GoogleConnectionId,
    orgId: OrganizationId,
  ) => Promise<string | null>

  /**
   * Null out all googleConnectionId references for a given connection.
   * Used by integration context when disconnecting a Google account.
   */
  clearGoogleConnectionRef: (
    orgId: OrganizationId,
    connectionId: GoogleConnectionId,
  ) => Promise<void>
}> &
  PropertySourceEpochPublicApi

export type { GoogleBindingState } from '../domain/google-binding-contract'
