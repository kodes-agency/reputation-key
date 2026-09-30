import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import type { SeriesReadingRow } from '../../domain/portal-results-series'

export type PortalRatingBucket = Readonly<{
  stars: number
  count: number
}>

/**
 * One governed Portal measure summed over a period. `portal.qualified_scan` is
 * the scan measure (raw `portal.scan` page opens are never summed here) and
 * `portal.review_link_click` carries Google opens only: readings whose
 * destination is a secondary link, or was never recorded, are excluded.
 */
export type PortalMetricSumRow = Readonly<{
  metricKey: string
  total: number
  count: number
}>

export type PortalMetricFamily =
  'scans' | 'privateRatings' | 'privateFeedback' | 'reviewLinkClicks'

export type MetricPortalMetricEvidence = Readonly<{
  definitionVersionId: string
  /**
   * `insufficient` means the pipeline is complete but the readings cannot
   * answer the question (Google opens with readings that never recorded which
   * destination was opened). Nothing is wrong, and nothing can be shown.
   */
  state: 'ready' | 'updating' | 'unavailable' | 'insufficient'
  verifiedThrough: Date | null
  latestActivity: Date | null
  computedAt: Date
  completeness: number
  availabilityReason: string | null
  correctionHead: Date | null
}>

export type MetricPortalMetricEvidenceSet = Readonly<
  Record<PortalMetricFamily, MetricPortalMetricEvidence>
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
  /**
   * Qualified scans and private ratings summed per week of the window, weeks
   * counted from `startLocalDate` (the Property-local date the window opens on)
   * by the readings' own `property_local_date`. The same governed, corrected
   * and counted readings as `getPortalKpiSums`, so the weeks add up to the KPIs.
   */
  getPortalWeeklyReadings(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
    startLocalDate: string,
  ): Promise<readonly SeriesReadingRow[]>
  getPortalMetricEvidence(
    organizationId: OrganizationId,
    propertyId: PropertyId,
    portalId: PortalId,
    startDate: Date,
    endDate: Date,
  ): Promise<MetricPortalMetricEvidenceSet>
}>
