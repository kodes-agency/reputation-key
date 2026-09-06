import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GooglePerformanceDailyMetric } from '#/shared/google-provider-control/contracts'

export {
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
  GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION as GOOGLE_PROVIDER_ROUTE_CATALOG_VERSION,
  GOOGLE_PROVIDER_ROUTE_KEYS,
} from '#/shared/google-provider-control/contracts'
export type { GoogleProviderRouteKey } from '#/shared/google-provider-control/contracts'
export const GOOGLE_BUSINESS_MANAGE_SCOPE =
  'https://www.googleapis.com/auth/business.manage'
export const GOOGLE_OIDC_ISSUERS = [
  'https://accounts.google.com',
  'accounts.google.com',
] as const

export {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PERFORMANCE_EXCLUDED_DAILY_METRICS,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
  MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES,
  isGooglePerformanceDailyMetric,
} from '#/shared/google-provider-control/contracts'
export type GoogleDailyMetric = GooglePerformanceDailyMetric

type GoogleProviderCallAuthorizationBase = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId | null
  connectionId: GoogleConnectionId
  expectedCredentialGeneration: number
  authorizationVector: Readonly<Record<string, string | number | boolean | null>>
}>

export type GoogleHumanProviderCallAuthorization = GoogleProviderCallAuthorizationBase &
  Readonly<{
    capability: 'property.import_gbp_v2' | 'property.read_gbp_performance'
    initiatorUserId: string
    /**
     * Exact server-generated authority for a disconnect revoke. The marker is
     * content-free and is consumed only by the authorized executor's durable
     * cleanup dispatcher before any provider socket can open.
     */
    disconnectRevoke?: Readonly<{
      attemptId: string
      cleanupDeadlineAtMs: number
    }>
  }>

export type GoogleDisconnectRevokeAuthorization = GoogleHumanProviderCallAuthorization &
  Readonly<{
    capability: 'property.import_gbp_v2'
    disconnectRevoke: Readonly<{
      attemptId: string
      cleanupDeadlineAtMs: number
    }>
  }>

export function isGoogleDisconnectRevokeAuthorization(
  authorization: GoogleProviderCallAuthorization,
): authorization is GoogleDisconnectRevokeAuthorization {
  return (
    authorization.capability === 'property.import_gbp_v2' &&
    'disconnectRevoke' in authorization &&
    authorization.disconnectRevoke !== undefined
  )
}

export type GoogleReviewSyncProviderCallAuthorization =
  GoogleProviderCallAuthorizationBase &
    Readonly<{
      capability: 'property.connect_gbp'
      propertyId: PropertyId
      initiatorUserId: null
    }>

export type GoogleReplyPublicationProviderCallAuthorization =
  GoogleProviderCallAuthorizationBase &
    Readonly<{
      capability: 'property.publish_reply'
      propertyId: PropertyId
      initiatorUserId: null
      publication: Readonly<{
        reviewId: string
        replyId: string
        publicationCycle: number
        attemptNumber: number
        sourceEpoch: number
        materialReviewRevision: number
      }>
    }>

export type GoogleProviderCallAuthorization =
  | GoogleHumanProviderCallAuthorization
  | GoogleReviewSyncProviderCallAuthorization
  | GoogleReplyPublicationProviderCallAuthorization
export type ProviderPage<T> = Readonly<{
  items: readonly T[]
  nextPageToken: string | null
}>

export type GbpAccount = Readonly<{
  resourceName: `accounts/${string}`
  accountId: string
  displayName: string
  role: 'primary_owner' | 'owner' | 'manager' | 'site_manager' | 'unknown'
}>

export type GoogleAccountManagementPort = Readonly<{
  listAccounts(
    input: Readonly<{
      accessToken: string
      authorization: GoogleProviderCallAuthorization
      pageToken?: string
      signal?: AbortSignal
    }>,
  ): Promise<ProviderPage<GbpAccount>>
}>

/**
 * Whether Google reports the location as having Voice of Merchant — its own
 * signal that a listing is verified and eligible to serve reviews and insights.
 * `unknown` means the provider gave us no usable evidence either way and must
 * never be treated as a denial.
 */
export type GbpLocationVerification = 'verified' | 'unverified' | 'unknown'

export type GbpLocationCandidate = Readonly<{
  binding: Readonly<{ accountId: string; locationId: string }>
  accountDisplayName: string
  businessName: string
  address: string | null
  primaryCategory: string | null
  countryCode: string | null
  /** Output-only provider destination; absent metadata is represented as null. */
  googleReviewUri?: string | null
  verification: GbpLocationVerification
}>

export type GoogleBusinessInformationPort = Readonly<{
  listLocations(
    input: Readonly<{
      accessToken: string
      authorization: GoogleProviderCallAuthorization
      accountId: string
      accountDisplayName: string
      pageToken?: string
      signal?: AbortSignal
    }>,
  ): Promise<ProviderPage<GbpLocationCandidate>>
}>

export type GooglePerformanceSourceReport = Readonly<{
  requestedRange: Readonly<{ startLocalDate: string; endLocalDate: string }>
  series: readonly Readonly<{
    metric: GoogleDailyMetric
    points: readonly Readonly<{ localDate: string; value: number }>[]
  }>[]
}>

export type GooglePerformanceSourcePort = Readonly<{
  fetchReport(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      connectionId: GoogleConnectionId
      expectedConnectionLifecycleVersion: number
      expectedConnectionAccessVersion: number
      expectedCredentialGeneration: number
      expectedSourceEpoch: number
      locationId: string
      startLocalDate: string
      endLocalDate: string
      signal?: AbortSignal
    }>,
  ): Promise<GooglePerformanceSourceReport>
}>
