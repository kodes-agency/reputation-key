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
  StaffDashboardData,
} from '../domain/types'
