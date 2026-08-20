/**
 * Public API for external consumers (components, routes, other contexts).
 * Re-exports domain types. Per boundary rules: external code may import
 * from `application/public-api` but NOT from `domain/`.
 */
export type {
  KPIValue,
  KPIs,
  RecentReview,
  DashboardReplyStatus,
  DashboardData,
  PortalKPIs,
  PortalAnalyticsData,
  StaffDashboardData,
  PortalRatingTrendPoint,
  AttentionSignals,
  FleetEntry,
  FleetOverviewData,
  FleetMetricFreshness,
  FleetMetricEvidence,
  FleetTotals,
} from '../domain/types'

// ── Error type re-exports (server functions must import from public-api, not domain/errors) ──
export type { DashboardErrorCode, DashboardError } from '../domain/errors'

export {
  GOOGLE_PERFORMANCE_ERROR_CODES,
  PROPERTY_PERFORMANCE_PRESETS,
  isGooglePerformanceErrorCode,
  isPropertyPerformancePreset,
} from '../../../shared/google-performance-report-contract'
export type {
  GooglePerformanceErrorCode,
  PerformanceAvailability,
  PerformanceMetricValue,
  PerformanceSeries,
  PropertyGooglePerformanceReportV1,
  PropertyGooglePerformanceResultV1,
  PropertyPerformancePreset,
} from '../../../shared/google-performance-report-contract'
export { isDashboardError } from '../domain/errors'
