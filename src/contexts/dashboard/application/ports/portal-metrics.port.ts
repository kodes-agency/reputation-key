// Dashboard context — PortalMetricsPort (facade port per ADR-0007)
// Aggregation queries for portal-scoped analytics.
// Portal analytics never imports metric_readings table directly — this port is the boundary.

import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { PortalRatingTrendPoint } from '../../domain/types'

export type { PortalRatingTrendPoint }

export type PortalRatingBucket = Readonly<{
  stars: number
  count: number
}>

export type PortalMetricSumRow = Readonly<{
  metricKey: string
  total: number
  count: number
}>

export type PortalMetricsPort = Readonly<{
  /** Summed metric values grouped by metricKey for a portal+period. */
  getPortalKpiSums(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalMetricSumRow[]>

  /** Count of portal.rating values bucketed by 1-5 for a portal+period. */
  getPortalRatingDistribution(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingBucket[]>

  /** Daily average of portal.rating for a portal+period. */
  getPortalRatingTrend(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<readonly PortalRatingTrendPoint[]>
}>
