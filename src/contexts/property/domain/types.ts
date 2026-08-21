// Property context — domain types
// Entity types for the property bounded context.
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type { OrganizationId, PropertyId, GoogleConnectionId } from '#/shared/domain/ids'
import type { PropertyLifecycleState } from './property-lifecycle'

/** Property entity — the organizational unit everything else lives under. */
export type Property = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  timezone: string
  address: string | null
  gbpLocationId: string | null
  gbpAccountId: string | null
  googleConnectionId: GoogleConnectionId | null
  profileVersion: number
  googleBindingState:
    'unbound' | 'account_confirmation_required' | 'active' | 'disconnected'
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
  processingRegionSource: string | null
  routingPolicyVersion: number
  processingRegionResolvedAt: Date | null
  sourceEpoch: number
}>

/** Default processing-profile fields for new properties (migration 0006). */
export const DEFAULT_PROPERTY_ROUTING = {
  countryCode: null,
  countrySource: 'organization_default',
  timezoneSource: 'legacy',
  timezoneResolvedAt: null,
  processingRegion: 'unresolved',
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
} as const satisfies Pick<
  Property,
  | 'address'
  | 'gbpAccountId'
  | 'profileVersion'
  | 'googleBindingState'
  | 'profileSource'
  | 'profileConfirmedAt'
  | 'profileConfirmedBy'
>

/** Re-export PropertyId from shared for convenience */
export type { PropertyId } from '#/shared/domain/ids'
