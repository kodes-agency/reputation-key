import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { Property } from '../../domain/types'
import type { GoogleBindingState } from '../../domain/google-binding-contract'
import type { PropertyGoogleReviewDestination } from '../../domain/google-review-destination'

export const PROPERTY_OPERATION_RECEIPT_TTL_MS = 32 * 24 * 60 * 60 * 1_000
export const PROPERTY_OPERATION_SWEEP_LIMIT = 100

export type PropertyOperationOutcome = 'imported' | 'relinked' | 'property_deleted'

export type PropertyOperationReceipt = Readonly<{
  organizationId: OrganizationId
  idempotencyKey: string
  destinationPropertyId: PropertyId | null
  outcome: PropertyOperationOutcome
  destinationSourceEpoch: number
  destinationProfileVersion: number
  tombstone: boolean
  expiresAt: Date
  retentionReleasedAt: Date | null
}>

/** Protected server-side view. Never serialize this type to a browser response. */
export type PropertyGoogleBindingInternalView = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  state: GoogleBindingState
  connectionId: GoogleConnectionId | null
  accountId: string | null
  locationId: string | null
  sourceEpoch: number
  profileVersion: number
  profileSource: 'legacy' | 'tenant_confirmed'
  profileConfirmedAt: Date | null
  deletedAt: Date | null
  name: string
  address: string | null
  countryCode: string | null
  timezone: string
  processingRegion: string | null
  lifecycleState: string
  googleReviewDestination: PropertyGoogleReviewDestination
}>

/** Browser-safe binding lifecycle. Contains no provider or connection identifiers. */
export type PropertyGoogleBindingSummary = Readonly<{
  state: GoogleBindingState
  sourceEpoch: number
  profileVersion: number
  profileSource: 'legacy' | 'tenant_confirmed'
  profileConfirmedAt: Date | null
}>

export type PropertyGoogleBindingErrorCode =
  | 'property_not_found'
  | 'property_deleted'
  | 'invalid_binding'
  | 'location_already_bound'
  | 'active_binding_conflict'
  | 'stale_binding'
  | 'stale_profile'
  | 'idempotency_conflict'
  | 'receipt_not_released'
  | 'sweep_limit_invalid'

export class PropertyGoogleBindingError extends Error {
  readonly code: PropertyGoogleBindingErrorCode

  constructor(code: PropertyGoogleBindingErrorCode) {
    super(`Property Google binding rejected: ${code}`)
    this.name = 'PropertyGoogleBindingError'
    this.code = code
  }
}

export type PropertyOperationCommit = Readonly<{
  propertyId: PropertyId | null
  outcome: PropertyOperationOutcome
  sourceEpoch: number
  profileVersion: number
  replayed: boolean
  tombstone: boolean
}>

export type PropertyGoogleBindingStore = Readonly<{
  readInternal: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<PropertyGoogleBindingInternalView | null>
  readByLocationIds: (
    organizationId: OrganizationId,
    locationIds: readonly string[],
  ) => Promise<readonly PropertyGoogleBindingInternalView[]>
  readSummary: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<PropertyGoogleBindingSummary | null>
  readReceipt: (
    organizationId: OrganizationId,
    idempotencyKey: string,
    now: Date,
  ) => Promise<PropertyOperationReceipt | null>
  createBoundProperty: (
    input: Readonly<{
      organizationId: OrganizationId
      idempotencyKey: string
      property: Property
      now: Date
    }>,
  ) => Promise<PropertyOperationCommit>
  relink: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      idempotencyKey: string
      connectionId: GoogleConnectionId
      accountId: string
      locationId: string
      profile: Readonly<{
        name: string
        address: string | null
        timezone: string
        confirmedBy: string
        googleReviewUri?: string | null
      }>
      expectedSourceEpoch: number
      expectedProfileVersion: number
      now: Date
    }>,
  ) => Promise<PropertyOperationCommit>
  disconnect: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      expectedSourceEpoch: number
      expectedProfileVersion: number
      now: Date
    }>,
  ) => Promise<PropertyGoogleBindingSummary>
  scrubProviderIdentity: (
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      expectedSourceEpoch: number
      expectedProfileVersion: number
      now: Date
    }>,
  ) => Promise<PropertyGoogleBindingSummary>
  releaseRetention: (
    input: Readonly<{
      organizationId: OrganizationId
      idempotencyKeys: readonly string[]
      releasedAt: Date
    }>,
  ) => Promise<number>
  releaseRetentionFromEvent: (
    input: Readonly<{
      eventId: string
      organizationId: OrganizationId
      idempotencyKeys: readonly string[]
      releasedAt: Date
    }>,
  ) => Promise<'applied' | 'duplicate'>
  sweepReleasedExpired: (
    input: Readonly<{
      now: Date
      limit: number
    }>,
  ) => Promise<number>
  countUnreleasedExpired: (
    input: Readonly<{
      now: Date
      limit: number
    }>,
  ) => Promise<number>
  cleanupOrganization: (organizationId: OrganizationId) => Promise<number>
}>
