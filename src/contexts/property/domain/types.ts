// Property context — domain types
// Entity types for the property bounded context.
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { PropertyLifecycleState } from './property-lifecycle'
import type { DataCellId } from '#/shared/domain/data-cell-catalogue'
import type { PropertyGoogleReviewDestination } from './google-review-destination'

/** Property entity — the organizational unit everything else lives under. */
export type Property = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  timezone: string
  /** Tenant-confirmed canonical concrete reply language tag. */
  defaultReplyLanguage?: string | null
  address: string | null
  gbpLocationId: string | null
  gbpAccountId: string | null
  googleConnectionId: GoogleConnectionId | null
  profileVersion: number
  googleBindingState:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
  /** Optional only during the expand/cutover window; constructors always set it. */
  googleReviewDestination?: PropertyGoogleReviewDestination
  profileSource: 'legacy' | 'tenant_confirmed'
  profileConfirmedAt: Date | null
  profileConfirmedBy: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  // B1.5: Lifecycle state machine
  lifecycleState: PropertyLifecycleState
  lifecycleReason: string | null
  lifecycleStateChangedAt: Date | null
  purgeScheduledFor: Date | null
  lifecycleInitiatedBy: string | null
  // PRE17B / BQR-1.1: Processing profile + routing (migration 0006)
  countryCode: string | null
  countrySource: string | null
  timezoneSource: string | null
  timezoneResolvedAt: Date | null
  processingRegion: string | null
  /** Canonical Property execution/residency assignment; null until resolved. */
  dataCellId: DataCellId | null
  processingRegionSource: string | null
  routingPolicyVersion: number
  processingRegionResolvedAt: Date | null
  sourceEpoch: number
  /** CAS token for explicit workflow-notification responsibility edits. */
  responsibleManagerRevision: number
  /** Visible recovery state; null while one or more active assignments exist. */
  responsibilityNeededSince: Date | null
}>

/** Default processing-profile fields for new properties (migration 0006). */
export const DEFAULT_PROPERTY_ROUTING = {
  countryCode: null,
  countrySource: 'organization_default',
  timezoneSource: 'legacy',
  timezoneResolvedAt: null,
  processingRegion: 'unresolved',
  dataCellId: null,
  processingRegionSource: 'country_default',
  routingPolicyVersion: 1,
  processingRegionResolvedAt: null,
  sourceEpoch: 0,
} as const satisfies Pick<
  Property,
  | 'countryCode'
  | 'countrySource'
  | 'timezoneSource'
  | 'timezoneResolvedAt'
  | 'processingRegion'
  | 'dataCellId'
  | 'processingRegionSource'
  | 'routingPolicyVersion'
  | 'processingRegionResolvedAt'
  | 'sourceEpoch'
>
export const DEFAULT_PROPERTY_GOOGLE_PROFILE = {
  address: null,
  gbpAccountId: null,
  profileVersion: 1,
  googleBindingState: 'unbound',
  profileSource: 'legacy',
  profileConfirmedAt: null,
  profileConfirmedBy: null,
  googleReviewDestination: {
    state: 'unavailable',
    uri: null,
    retrievedAt: null,
    sourceEpoch: null,
    profileVersion: null,
  },
} as const satisfies Pick<
  Property,
  | 'address'
  | 'gbpAccountId'
  | 'profileVersion'
  | 'googleBindingState'
  | 'profileSource'
  | 'profileConfirmedAt'
  | 'profileConfirmedBy'
  | 'googleReviewDestination'
>

/** Re-export PropertyId from shared for convenience */
export type { PropertyId } from '#/shared/domain/ids'
