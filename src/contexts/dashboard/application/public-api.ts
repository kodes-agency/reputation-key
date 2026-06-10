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
} from '../domain/types'

// ── Error type re-exports (server functions must import from public-api, not domain/errors) ──
export type { DashboardErrorCode, DashboardError } from '../domain/errors'
export { isDashboardError } from '../domain/errors'
