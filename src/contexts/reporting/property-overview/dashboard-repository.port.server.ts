import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  RecentReview,
} from '../domain/dashboard-types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** Common query params for most dashboard methods. */
export type DashboardPeriodQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  startDate: Date
  endDate: Date
}>

/** Extended query with prior period. */
export type DashboardKPIQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  startDate: Date
  endDate: Date
  comparisonPeriod: DashboardComparisonPeriod | null
}>

export type DashboardComparisonPeriod = Readonly<{
  priorStartDate: Date
  priorEndDate: Date
}>

/** Query for recent reviews (no date range — always last N). */
export type DashboardRecentReviewsQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  limit?: number
}>

export type DashboardRepository = Readonly<{
  getKPIs(input: DashboardKPIQuery): Promise<KPIs>
  getRatingDistribution(input: DashboardPeriodQuery): Promise<RatingDistribution>
  getRatingTrend(input: DashboardPeriodQuery): Promise<RatingTrendPoint[]>
  getReviewVolume(input: DashboardPeriodQuery): Promise<ReviewVolumePoint[]>
  getReplyPerformance(input: DashboardPeriodQuery): Promise<ReplyPerformance>
  getRecentReviews(input: DashboardRecentReviewsQuery): Promise<RecentReview[]>
}>
