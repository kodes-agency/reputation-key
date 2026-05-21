// Dashboard context — repository port (interface)

import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  EngagementFunnel,
  RecentReview,
} from '../domain/types'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

/** Common query params for most dashboard methods. */
export type DashboardPeriodQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  startDate: Date
  endDate: Date
}>

/** Extended query with portal scope and prior period. */
export type DashboardKPIQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId | null
  startDate: Date
  endDate: Date
  priorStartDate: Date
  priorEndDate: Date
}>

/** Query for portal-scoped metrics. */
export type DashboardPortalQuery = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
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
  getEngagementFunnel(input: DashboardPortalQuery): Promise<EngagementFunnel>
  getRecentReviews(input: DashboardRecentReviewsQuery): Promise<RecentReview[]>
}>
