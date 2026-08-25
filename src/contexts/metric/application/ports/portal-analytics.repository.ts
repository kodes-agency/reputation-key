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

export type PortalMetricFamily =
  'scans' | 'privateRatings' | 'privateFeedback' | 'reviewLinkClicks'

export type PortalMetricEvidence = Readonly<{
  definitionVersionId: string
  state: 'ready' | 'updating' | 'unavailable'
  verifiedThrough: Date | null
  latestActivity: Date | null
  computedAt: Date
  completeness: number
  availabilityReason: string | null
  correctionHead: Date | null
}>

export type PortalMetricEvidenceSet = Readonly<
  Record<PortalMetricFamily, PortalMetricEvidence>
>

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
  getPortalMetricEvidence(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<PortalMetricEvidenceSet>
}>
