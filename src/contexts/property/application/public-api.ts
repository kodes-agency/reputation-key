// Property context — public API surface for cross-context consumers.
// Other contexts (team, portal, integration) consume this typed interface
// to query property data. Per ADR-0001.

import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { PropertyGoogleBindingStore } from './ports/property-google-binding.port'
export { buildGoogleImportedProperty } from './build-google-imported-property'
export type { BuildGoogleImportedPropertyInput } from './build-google-imported-property'
export type {
  PropertyCreated,
  PropertyDeleted,
  PropertyUpdated,
  PropertyResponsibilityNeeded,
} from '../domain/events'

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

// Sanctioned fail-closed cell gates for protected workloads (BQC-4.1 / ADR 0048).
export {
  ROUTING_POLICY_VERSION,
  isRegionProcessable,
  assertRegionResolved,
} from '../domain/processing-routing'
/** Content-free property facts for governed cross-context workflows. */
export type PropertyFactsPublicApi = Readonly<{
  getPropertyTimezone: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
}>

/** Region and binding generation read from one property snapshot. */
export type PropertyProcessingScopePublicApi = Readonly<{
  getProcessingScope: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<Readonly<{ processingRegion: string | null; sourceEpoch: number }> | null>
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
   * Find a non-deleted property by its slug.
   * No organizationId — the slug is public-facing, used for guest portal resolution.
   */
  findBySlug: (slug: string) => Promise<PropertySlugLookupResult | null>

  /**
   * Find all non-deleted property IDs linked to a Google connection within an org.
   * Used by Integration connection lifecycle handling.
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
   * Get a property's persisted processing region (content-free routing fact).
   * Returns null when the property is missing/deleted — callers must treat
   * null as not processable (fail closed, ADR 0048 / BQC-4.1).
   */
  getProcessingRegion: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
}>

/** Kept separate so ordinary Property readers do not acquire notification policy. */
export type PropertyResponsibleManagerPublicApi = Readonly<{
  /** Current explicit managers, revalidated against role/access/participation. */
  getResponsibleManagerUserIds: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<import('#/shared/domain/ids').UserId>>
  /** Eligibility check for direct work recipients such as Inbox assignees. */
  isEligibleResponsibleManagerUserId: (
    orgId: OrganizationId,
    propertyId: PropertyId,
    userId: import('#/shared/domain/ids').UserId,
  ) => Promise<boolean>
}>

/** Optional product preference kept separate from the widely mocked core API. */
export type PropertyReplyLanguagePublicApi = Readonly<{
  getPropertyReplyLanguage: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
}>

export {
  GOOGLE_BINDING_STATES,
  PROPERTY_GOOGLE_BINDING_CHANGED_EVENT,
  isGoogleBindingState,
} from '../domain/google-binding-contract'
export type {
  GoogleBindingState,
  GoogleLocationBinding,
  PropertyGoogleBindingChangedV1,
} from '../domain/google-binding-contract'
