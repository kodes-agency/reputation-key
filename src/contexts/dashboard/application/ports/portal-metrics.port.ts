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

/**
 * The repository-facing evidence row, distinct from the domain's
 * `PortalMetricEvidence` in ../../domain/types: this one is what an adapter
 * returns (definitionVersionId always present, a narrower state union, no
 * basis or sampleCount), and the domain type is what the use case builds from
 * it. They shared a name until Fallow flagged the duplicate export.
 */
export type PortalMetricEvidenceRead = Readonly<{
  definitionVersionId: string
  state: 'ready' | 'updating' | 'unavailable'
  verifiedThrough: Date | null
  latestActivity: Date | null
  computedAt: Date
  completeness: number
  availabilityReason: string | null
  correctionHead: Date | null
}>

export type PortalMetricEvidenceSet = Readonly<{
  scans: PortalMetricEvidenceRead
  privateRatings: PortalMetricEvidenceRead
  privateFeedback: PortalMetricEvidenceRead
  reviewLinkClicks: PortalMetricEvidenceRead
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

  getPortalMetricEvidence(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<PortalMetricEvidenceSet>
}>
