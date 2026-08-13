import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GooglePerformanceDailyMetric } from '#/shared/google-provider-control/contracts'

export const GOOGLE_PROVIDER_ROUTE_CATALOG_VERSION = 'google-provider-routes-1' as const
export const GOOGLE_BUSINESS_MANAGE_SCOPE =
  'https://www.googleapis.com/auth/business.manage'
export const GOOGLE_OIDC_ISSUERS = [
  'https://accounts.google.com',
  'accounts.google.com',
] as const

export const GOOGLE_PROVIDER_ROUTE_KEYS = {
  oauthToken: 'google.oauth.token',
  oauthRevoke: 'google.oauth.revoke',
  oidcJwks: 'google.oidc.jwks',
  accountManagementList: 'google.account-management.accounts.list',
  businessInformationList: 'google.business-information.locations.list',
  reviewsList: 'google.reviews.v4.list',
  reviewsReply: 'google.reviews.v4.reply',
  performanceFetchMultiDailyMetrics:
    'google.performance.fetch-multi-daily-metrics-time-series',
} as const
export type GoogleProviderRouteKey =
  (typeof GOOGLE_PROVIDER_ROUTE_KEYS)[keyof typeof GOOGLE_PROVIDER_ROUTE_KEYS]

export {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_PERFORMANCE_DAILY_METRICS,
  GOOGLE_PERFORMANCE_EXCLUDED_DAILY_METRICS,
  MAX_GOOGLE_PERFORMANCE_DAILY_VALUE,
  MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES,
  isGooglePerformanceDailyMetric,
} from '#/shared/google-provider-control/contracts'
export type GoogleDailyMetric = GooglePerformanceDailyMetric

export type GoogleProviderCallAuthorization = Readonly<{
  capability: 'property.import_gbp_v2' | 'property.read_gbp_performance'
  organizationId: OrganizationId
  propertyId: PropertyId | null
  connectionId: GoogleConnectionId
  initiatorUserId: string
  approvalBindingId: string
  authorizationVector: Readonly<Record<string, string | number | boolean | null>>
}>
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

export type GbpLocationCandidate = Readonly<{
  binding: Readonly<{ accountId: string; locationId: string }>
  accountDisplayName: string
  businessName: string
  address: string | null
  primaryCategory: string | null
  countryCode: string | null
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
