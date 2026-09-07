// Property context — domain types
// Entity types for the property bounded context.
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { PropertyLifecycleState } from './property-lifecycle'
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
  // Property locale facts.
  countryCode: string | null
  countrySource: string | null
  timezoneSource: string | null
  timezoneResolvedAt: Date | null
  sourceEpoch: number
  /** CAS token for explicit workflow-notification responsibility edits. */
  responsibleManagerRevision: number
  /** Visible recovery state; null while one or more active assignments exist. */
  responsibilityNeededSince: Date | null
}>

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
