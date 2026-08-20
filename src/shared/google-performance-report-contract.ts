import { GOOGLE_PERFORMANCE_CATALOG_VERSION } from '#/shared/google-provider-control/contracts'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'

export { GOOGLE_PERFORMANCE_CATALOG_VERSION }

export const PROPERTY_PERFORMANCE_PRESETS = ['7d', '30d', '90d', '180d'] as const
export type PropertyPerformancePreset = (typeof PROPERTY_PERFORMANCE_PRESETS)[number]

const PROPERTY_PERFORMANCE_PRESET_SET = new Set<string>(PROPERTY_PERFORMANCE_PRESETS)

export function isPropertyPerformancePreset(
  value: string,
): value is PropertyPerformancePreset {
  return PROPERTY_PERFORMANCE_PRESET_SET.has(value)
}

export const GOOGLE_PERFORMANCE_ERROR_CODES = [
  'rate_limited',
  'provider_timeout',
  'provider_rejected',
  'temporarily_unavailable',
  'malformed_provider_response',
  'stale_source',
] as const
export type GooglePerformanceErrorCode = (typeof GOOGLE_PERFORMANCE_ERROR_CODES)[number]

const GOOGLE_PERFORMANCE_ERROR_CODE_SET = new Set<string>(GOOGLE_PERFORMANCE_ERROR_CODES)

export function isGooglePerformanceErrorCode(
  value: string,
): value is GooglePerformanceErrorCode {
  return GOOGLE_PERFORMANCE_ERROR_CODE_SET.has(value)
}

export type PerformanceAvailability =
  | 'ready'
  | 'partial'
  | 'not_applicable_or_not_returned'
  | 'no_complete_days'

export type PerformanceMetricValue = Readonly<{
  label: string
  value: number | null
  priorValue: number | null
  deltaPercent: number | null
  availability: PerformanceAvailability
  completeDayCount: number
  priorCompleteDayCount: number
}>

export type PerformanceSeries = Readonly<{
  id: string
  label: string
  points: readonly Readonly<{
    localDate: string
    value: number | null
    availability: 'returned' | 'unavailable'
  }>[]
}>

export type PropertyGooglePerformanceReportV1 = Readonly<{
  contractVersion: 1
  catalogVersion: typeof GOOGLE_PERFORMANCE_CATALOG_VERSION
  sourceLabel: 'Google Business Profile'
  retrievedAt: string
  contentExpiresAt: string
  contentTtlSeconds: number
  authorizationLease: ProviderContentLeaseDto
  period: Readonly<{
    preset: PropertyPerformancePreset
    timezone: string
    currentStartLocalDate: string
    currentEndLocalDate: string
    priorStartLocalDate: string
    priorEndLocalDate: string
  }>
  sourceHealth: Readonly<{
    state: 'ready' | 'partial' | 'no_data' | 'delayed' | 'stale'
    providerCheckedThroughLocalDate: string
    latestReturnedDataLocalDate: string | null
    latestCompleteCoreLocalDate: string | null
    dataLagDays: number | null
  }>
  headlines: Readonly<{
    totalProfileImpressions: PerformanceMetricValue
    websiteClicks: PerformanceMetricValue
    callClicks: PerformanceMetricValue
    directionRequests: PerformanceMetricValue
  }>
  discoverySeries: readonly PerformanceSeries[]
  actionSeries: readonly PerformanceSeries[]
  additionalInteractions: readonly PerformanceMetricValue[]
}>

export type PropertyGooglePerformanceResultV1 =
  | Readonly<{ status: 'ready'; data: PropertyGooglePerformanceReportV1 }>
  | Readonly<{
      status: 'unavailable'
      reason:
        | 'policy_disabled'
        | 'timezone_required'
        | 'disconnected'
        | 'reauthentication_required'
        | 'integration_unavailable'
      action: 'set_timezone' | 'reauthenticate' | 'open_integrations' | null
    }>
  | Readonly<{
      status: 'error'
      errorCode: GooglePerformanceErrorCode
      retryable: boolean
      retryAfterSeconds: number | null
    }>
