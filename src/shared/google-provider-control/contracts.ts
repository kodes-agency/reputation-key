export const GOOGLE_ENDPOINT_CLASSES = [
  'account-management',
  'business-information',
  'performance',
  'oauth-token',
  'oauth-jwks',
  'oauth-revoke',
  'reviews',
  'notifications',
] as const
export type GoogleEndpointClass = (typeof GOOGLE_ENDPOINT_CLASSES)[number]

export const GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION = '2026-08-27' as const

export const GOOGLE_PERFORMANCE_CATALOG_VERSION = '2026-08-05' as const
export const GOOGLE_PERFORMANCE_DAILY_METRICS = Object.freeze([
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'WEBSITE_CLICKS',
  'BUSINESS_BOOKINGS',
  'BUSINESS_FOOD_MENU_CLICKS',
] as const)
const GOOGLE_PERFORMANCE_DAILY_METRIC_SET = new Set<string>(
  GOOGLE_PERFORMANCE_DAILY_METRICS,
)
export function isGooglePerformanceDailyMetric(
  value: string,
): value is GooglePerformanceDailyMetric {
  return GOOGLE_PERFORMANCE_DAILY_METRIC_SET.has(value)
}
export const MAX_GOOGLE_PERFORMANCE_DAILY_VALUE = 6_152_458_507_336 as const
export const MAX_GOOGLE_PERFORMANCE_RESPONSE_BYTES = 5 * 1024 * 1024
export type GooglePerformanceDailyMetric =
  (typeof GOOGLE_PERFORMANCE_DAILY_METRICS)[number]
export const GOOGLE_PERFORMANCE_EXCLUDED_DAILY_METRICS = Object.freeze([
  'DAILY_METRIC_UNKNOWN',
  'BUSINESS_FOOD_ORDERS',
] as const)
export const GOOGLE_PROVIDER_ROUTE_KEYS = [
  'account-management.accounts.list',
  'business-information.locations.list',
  'performance.fetch',
  'oauth.token.exchange',
  'oauth.token.refresh',
  'oauth.jwks',
  'oauth.revoke',
  'notifications.get',
  'notifications.subscribe',
  'notifications.unsubscribe',
  'reviews.list',
  'reviews.get',
  'reviews.reply',
] as const
export type GoogleProviderRouteKey = (typeof GOOGLE_PROVIDER_ROUTE_KEYS)[number]

export type GoogleRequestClass =
  | 'identity'
  | 'discovery'
  | 'performance'
  | 'credential_refresh'
  | 'credential_cleanup'
  | 'reviews'
  | 'notifications'

export type GoogleAuthorizationVector = Readonly<{
  lifecycleVersion: number
  accessVersion: number
  credentialGeneration: number
  propertyAuthorizationGeneration: number | null
  capabilityPolicyVersion: 'beta-local-2'
  executionPolicyVersion: 'beta-local-2'
  routingPolicyVersion: number
}>

export type GoogleExecutionAdmissionRequest = Readonly<{
  capability:
    | 'property.import_gbp_v2'
    | 'property.read_gbp_performance'
    | 'property.connect_gbp'
    | 'property.publish_reply'
  organizationId: string
  propertyId: string | null
  connectionId: string
  authorization: GoogleAuthorizationVector
  routeKey: GoogleProviderRouteKey
  routeCatalogueVersion: typeof GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION
  endpointClass: GoogleEndpointClass
  requestClass: GoogleRequestClass
  requestBindingSha256: string
  credentialBinding: string
  requestBodySha256: string | null
  requestBodyBytes: number
  maxRequestBytes: number
  maxResponseBytes: number
  quotaPolicyId: string
  inFlightPolicyId: string
  deadlineMs: number
}>

export type GoogleExecutionPermit = GoogleExecutionAdmissionRequest &
  Readonly<{
    permitId: string
    issuedAtMs: number
    expiresAtMs: number
  }>

export type GoogleAdmissionDenyCode =
  | 'denied_by_default'
  | 'malformed_request'
  | 'deadline_exceeded'
  | 'request_too_large'
  | 'authorization_drift'
  | 'route_mismatch'
  | 'catalogue_mismatch'
  | 'endpoint_mismatch'
  | 'request_class_mismatch'
  | 'request_binding_mismatch'
  | 'credential_mismatch'
  | 'body_mismatch'
  | 'quota_policy_mismatch'
  | 'permit_unknown'
  | 'permit_expired'
  | 'permit_replayed'
export type GoogleAdmissionResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: GoogleAdmissionDenyCode }>

export type GoogleExecutionAdmission = Readonly<{
  issue: (
    request: GoogleExecutionAdmissionRequest,
  ) => Promise<GoogleAdmissionResult<GoogleExecutionPermit>>
  consume: (
    permit: GoogleExecutionPermit,
    actual: GoogleExecutionAdmissionRequest,
  ) => Promise<GoogleAdmissionResult<GoogleExecutionPermit>>
}>

export type GoogleQuotaKey = Readonly<{
  credentialFingerprint: string
  projectFingerprint: string
  endpointClass: GoogleEndpointClass
  organizationId: string
  initiatorUserId: string | null
  connectionId: string | null
  propertyId: string | null
}>

export type GoogleQuotaResult =
  | Readonly<{ ok: true; remaining: number }>
  | Readonly<{
      ok: false
      code:
        | 'quota_exhausted'
        | 'deadline_exceeded'
        | 'invalid_request'
        | 'coordination_unavailable'
        | 'key_collision'
      retryAfterMs: number
    }>

export type GoogleQuotaCoordinator = Readonly<{
  acquire: (
    key: GoogleQuotaKey,
    cost: number,
    deadlineMs: number,
  ) => Promise<GoogleQuotaResult>
}>

export type GoogleInFlightKey = GoogleQuotaKey &
  Readonly<{ requestClass: GoogleRequestClass }>

export type GoogleInFlightLease = Readonly<{
  leaseId: string
  expiresAtMs: number
}>

export type GoogleInFlightResult =
  | Readonly<{ ok: true; lease: GoogleInFlightLease }>
  | Readonly<{
      ok: false
      code:
        | 'limit_exhausted'
        | 'deadline_exceeded'
        | 'invalid_request'
        | 'coordination_unavailable'
        | 'key_collision'
      retryAfterMs: number
    }>

export type GoogleInFlightCoordinator = Readonly<{
  acquire: (key: GoogleInFlightKey, deadlineMs: number) => Promise<GoogleInFlightResult>
  release: (key: GoogleInFlightKey, lease: GoogleInFlightLease) => Promise<boolean>
}>
