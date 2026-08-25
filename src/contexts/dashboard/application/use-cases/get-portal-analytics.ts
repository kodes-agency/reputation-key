// Dashboard context — getPortalAnalytics use case
// Orchestrates portal-scoped queries into a single PortalAnalyticsData response.
// Authorization is enforced at the router/loader level (property ownership). No auth logic here.

import type { DashboardRepository } from '../ports/dashboard.repository'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type { PortalAnalyticsData, PortalKPIs } from '../../domain/types'
import type { PortalMetricsPort, PortalMetricSumRow } from '../ports/portal-metrics.port'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { computeTrend, priorPeriodDates } from '../utils'
import type { PortalResponseIntegrityPort } from '../ports/portal-response-integrity.port'

const MIN_RATING_COMPARISON_SAMPLE = 10

function roundedRating(value: number): number {
  return Math.round(value * 10) / 10
}

export type GetPortalAnalyticsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
}>

export type GetPortalAnalyticsDeps = Readonly<{
  repo: DashboardRepository
  portalMetrics: PortalMetricsPort
  responseIntegrity: PortalResponseIntegrityPort
  clock: () => Date
}>
export type GetPortalAnalytics = ReturnType<typeof getPortalAnalytics>

export const getPortalAnalytics =
  (deps: GetPortalAnalyticsDeps) =>
  // Pre-existing KPI assembly complexity — owner: Dashboard (BQC-5.5); still
  // matches on unit-size, no expiry while over threshold. BQC-5.5 only shifted
  // its line (dupe removal), re-registering the finding.
  // fallow-ignore-next-line complexity
  async (input: GetPortalAnalyticsInput): Promise<PortalAnalyticsData> => {
    const { organizationId, propertyId, portalId, startDate, endDate, timeRange } = input

    // 'all' is unbounded, so there is no prior window: priorPeriodDates returns
    // null and the second getPortalKpiSums call is skipped entirely. Passing the
    // current window as its own prior (the old behaviour) both duplicated a
    // scan-from-epoch on every page load and fabricated a 0% trend.
    const priorPeriod = priorPeriodDates(timeRange, startDate, endDate)

    // Fetch current and prior KPI sums, rating distribution, rating trend, and engagement funnel in parallel
    const [
      currentSums,
      priorSums,
      ratingDistribution,
      ratingTrend,
      engagementFunnel,
      responseIntegrity,
    ] = await Promise.all([
      deps.portalMetrics.getPortalKpiSums(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      priorPeriod
        ? deps.portalMetrics.getPortalKpiSums(
            organizationId,
            propertyId,
            portalId,
            priorPeriod.priorStartDate,
            priorPeriod.priorEndDate,
          )
        : Promise.resolve<readonly PortalMetricSumRow[]>([]),
      deps.portalMetrics.getPortalRatingDistribution(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      deps.portalMetrics.getPortalRatingTrend(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      deps.repo.getEngagementFunnel({
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      }),
      deps.responseIntegrity.getPortalResponseIntegritySummary({
        organizationId,
        propertyId,
        portalId,
        startAt: startDate,
        endAt: endDate,
      }),
    ])

    const toMap = (
      rows: readonly { metricKey: string; total: number; count: number }[],
    ) => new Map(rows.map((r) => [r.metricKey, r]))

    const cur = toMap(currentSums)
    // For 'all' priorSums is empty, so every priorValue is 0 and computeTrend's
    // `prior === 0` guard yields trend: null — the cards render an em dash
    // instead of a made-up 0%.
    const prior = toMap(priorSums)

    const curScans = cur.get('portal.scan')
    const priorScans = prior.get('portal.scan')
    const curFeedback = cur.get('portal.feedback')
    const priorFeedback = prior.get('portal.feedback')
    const curRating = cur.get('portal.rating')
    const priorRating = prior.get('portal.rating')
    const curReviewLink = cur.get('portal.review_link_click')
    const priorReviewLink = prior.get('portal.review_link_click')

    const curRatingCount = curRating?.count ?? 0
    const priorRatingCount = priorRating?.count ?? 0
    const curAvgRating =
      curRating && curRatingCount > 0
        ? roundedRating(curRating.total / curRatingCount)
        : null
    const priorAvgRating =
      priorRating && priorRatingCount > 0
        ? roundedRating(priorRating.total / priorRatingCount)
        : null
    const ratingComparison =
      timeRange !== 'all' &&
      curAvgRating !== null &&
      priorAvgRating !== null &&
      curRatingCount >= MIN_RATING_COMPARISON_SAMPLE &&
      priorRatingCount >= MIN_RATING_COMPARISON_SAMPLE
        ? roundedRating(curAvgRating - priorAvgRating)
        : null

    const kpis: PortalKPIs = {
      scans: {
        value: curScans?.total ?? 0,
        priorValue: priorScans?.total ?? 0,
        trend: computeTrend(curScans?.total ?? 0, priorScans?.total ?? 0),
      },
      avgRating: {
        value: curAvgRating,
        priorValue: priorAvgRating,
        comparison: ratingComparison,
        sampleCount: curRatingCount,
        priorSampleCount: priorRatingCount,
      },
      feedback: {
        value: curFeedback?.total ?? 0,
        priorValue: priorFeedback?.total ?? 0,
        trend: computeTrend(curFeedback?.total ?? 0, priorFeedback?.total ?? 0),
      },
      reviewLinkClicks: {
        value: curReviewLink?.total ?? 0,
        priorValue: priorReviewLink?.total ?? 0,
        trend: computeTrend(curReviewLink?.total ?? 0, priorReviewLink?.total ?? 0),
      },
    }

    return {
      kpis,
      engagementFunnel,
      ratingDistribution,
      ratingTrend: [...ratingTrend],
      responseIntegrity,
    }
  }
