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

export type DashboardRepository = Readonly<{
  getKPIs(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    portalId: PortalId | null
    startDate: Date
    endDate: Date
    priorStartDate: Date
    priorEndDate: Date
  }): Promise<KPIs>

  getRatingDistribution(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    startDate: Date
    endDate: Date
  }): Promise<RatingDistribution>

  getRatingTrend(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    startDate: Date
    endDate: Date
  }): Promise<RatingTrendPoint[]>

  getReviewVolume(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    startDate: Date
    endDate: Date
  }): Promise<ReviewVolumePoint[]>

  getReplyPerformance(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    startDate: Date
    endDate: Date
  }): Promise<ReplyPerformance>

  getEngagementFunnel(input: {
    organizationId: OrganizationId
    portalId: PortalId
    startDate: Date
    endDate: Date
  }): Promise<EngagementFunnel>

  getRecentReviews(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    limit?: number
  }): Promise<RecentReview[]>
}>
