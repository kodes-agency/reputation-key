import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'

export type PortalRatingTrendPoint = Readonly<{
  date: string
  avgRating: number
}>

export type PortalRatingBucket = Readonly<{
  stars: number
  count: number
}>

export type PortalMetricSumRow = Readonly<{
  metricKey: string
  total: number
  count: number
}>

export type PortalAnalyticsRepository = Readonly<{
  getPortalKpiSums(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalMetricSumRow[]>
  getPortalRatingDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingBucket[]>
  getPortalRatingTrend(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingTrendPoint[]>
}>
