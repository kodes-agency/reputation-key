// Dashboard context — getPortalAnalytics use case
// Orchestrates portal-scoped queries into a single PortalAnalyticsData response.
// Authorization is enforced at the router/loader level (property ownership). No auth logic here.

import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'
import type {
  PortalAnalyticsData,
  PortalMetricEvidence,
  PortalKPIs,
} from '../../domain/types'
import type {
  PortalMetricEvidence as SourceMetricEvidence,
  PortalMetricsPort,
  PortalMetricSumRow,
} from '../ports/portal-metrics.port'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { computeTrend, priorPeriodDates, ratingComparison } from '../utils'
import type { PortalResponseIntegrityPort } from '../ports/portal-response-integrity.port'
import type { PortalLifetimeMetricsPort } from '../ports/portal-lifetime-metrics.port'
import { portalLifetimeAnalyticsData } from './portal-lifetime-analytics'

function roundedRating(value: number): number {
  return Math.round(value * 10) / 10
}

function metricEvidence(
  source: SourceMetricEvidence,
  sampleCount: number,
  insufficientWhenEmpty = false,
): PortalMetricEvidence {
  return {
    ...source,
    state:
      source.state === 'unavailable'
        ? 'temporarily_unavailable'
        : source.state === 'updating'
          ? 'updating'
          : insufficientWhenEmpty && sampleCount === 0
            ? 'insufficient_data'
            : 'ready',
    sampleCount,
  }
}

export type GetPortalAnalyticsInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  propertyTimezone: string
}>

export type GetPortalAnalyticsDeps = Readonly<{
  portalMetrics: PortalMetricsPort
  portalLifetime: PortalLifetimeMetricsPort
  responseIntegrity: PortalResponseIntegrityPort
}>
export type GetPortalAnalytics = ReturnType<typeof getPortalAnalytics>

export const getPortalAnalytics =
  (deps: GetPortalAnalyticsDeps) =>
  // Pre-existing KPI assembly complexity — owner: Dashboard (BQC-5.5); still
  // matches on unit-size, no expiry while over threshold. BQC-5.5 only shifted
  // its line (dupe removal), re-registering the finding.
  // fallow-ignore-next-line complexity
  async (input: GetPortalAnalyticsInput): Promise<PortalAnalyticsData> => {
    const {
      organizationId,
      propertyId,
      portalId,
      startDate,
      endDate,
      timeRange,
      propertyTimezone,
    } = input

    if (timeRange === 'all') {
      const [lifetime, responseIntegrity] = await Promise.all([
        deps.portalLifetime.get({ organizationId, propertyId, portalId }),
        deps.responseIntegrity.getPortalResponseIntegritySummary({
          organizationId,
          propertyId,
          portalId,
          startAt: startDate,
          endAt: endDate,
        }),
      ])
      return portalLifetimeAnalyticsData(input, lifetime, responseIntegrity)
    }

    // The All Time branch above never reaches the period projection. Every
    // bounded preset receives one equal-length Property-local prior window.
    const priorPeriod = priorPeriodDates(timeRange, startDate, endDate, propertyTimezone)

    // Fetch governed current/prior values and evidence in parallel. The owner
    // API proves whether a zero is complete before Dashboard can render it.
    const [
      currentSums,
      priorSums,
      ratingDistribution,
      ratingTrend,
      responseIntegrity,
      currentEvidence,
      priorEvidence,
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
      deps.responseIntegrity.getPortalResponseIntegritySummary({
        organizationId,
        propertyId,
        portalId,
        startAt: startDate,
        endAt: endDate,
      }),
      deps.portalMetrics.getPortalMetricEvidence(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      ),
      priorPeriod
        ? deps.portalMetrics.getPortalMetricEvidence(
            organizationId,
            propertyId,
            portalId,
            priorPeriod.priorStartDate,
            priorPeriod.priorEndDate,
          )
        : Promise.resolve(null),
    ])

    const toMap = (
      rows: readonly { metricKey: string; total: number; count: number }[],
    ) => new Map(rows.map((r) => [r.metricKey, r]))

    const cur = toMap(currentSums)
    const prior = toMap(priorSums)

    const curScans = cur.get('portal.scan')
    const priorScans = prior.get('portal.scan')
    const curFeedback = cur.get('portal.feedback')
    const priorFeedback = prior.get('portal.feedback')
    const curRating = cur.get('portal.rating')
    const priorRating = prior.get('portal.rating')
    const curReviewLink = cur.get('portal.review_link_click')
    const priorReviewLink = prior.get('portal.review_link_click')

    const countKpi = (
      current: PortalMetricSumRow | undefined,
      previous: PortalMetricSumRow | undefined,
      currentSourceEvidence: SourceMetricEvidence,
      priorSourceEvidence: SourceMetricEvidence | null,
    ) => {
      const value = currentSourceEvidence.state === 'ready' ? (current?.total ?? 0) : null
      const priorValue =
        priorSourceEvidence?.state === 'ready' ? (previous?.total ?? 0) : null
      return {
        value,
        priorValue,
        trend:
          value !== null && priorValue !== null ? computeTrend(value, priorValue) : null,
        evidence: metricEvidence(currentSourceEvidence, current?.count ?? 0),
      }
    }

    const curRatingCount = curRating?.count ?? 0
    const priorRatingCount = priorRating?.count ?? 0
    const curRatingReady = currentEvidence.privateRatings.state === 'ready'
    const priorRatingReady = priorEvidence?.privateRatings.state === 'ready'
    const curAvgRating =
      curRatingReady && curRating && curRatingCount > 0
        ? roundedRating(curRating.total / curRatingCount)
        : null
    const priorAvgRating =
      priorRatingReady && priorRating && priorRatingCount > 0
        ? roundedRating(priorRating.total / priorRatingCount)
        : null
    const privateRatingComparison =
      curAvgRating !== null && priorAvgRating !== null
        ? ratingComparison(curAvgRating, curRatingCount, priorAvgRating, priorRatingCount)
        : null

    const kpis: PortalKPIs = {
      scans: countKpi(
        curScans,
        priorScans,
        currentEvidence.scans,
        priorEvidence?.scans ?? null,
      ),
      avgRating: {
        value: curAvgRating,
        priorValue: priorAvgRating,
        comparison: privateRatingComparison,
        sampleCount: curRatingCount,
        priorSampleCount: priorRatingCount,
        evidence: metricEvidence(currentEvidence.privateRatings, curRatingCount, true),
      },
      feedback: countKpi(
        curFeedback,
        priorFeedback,
        currentEvidence.privateFeedback,
        priorEvidence?.privateFeedback ?? null,
      ),
      reviewLinkClicks: countKpi(
        curReviewLink,
        priorReviewLink,
        currentEvidence.reviewLinkClicks,
        priorEvidence?.reviewLinkClicks ?? null,
      ),
    }

    const engagementFunnel =
      currentEvidence.scans.state === 'ready' &&
      currentEvidence.privateRatings.state === 'ready' &&
      currentEvidence.reviewLinkClicks.state === 'ready'
        ? {
            scans: curScans?.total ?? 0,
            ratings: curRatingCount,
            reviewLinkClicks: curReviewLink?.total ?? 0,
          }
        : null

    return {
      period: { startAt: startDate, endAt: endDate, timezone: propertyTimezone },
      lifetimeReconciliation: null,
      kpis,
      engagementFunnel,
      ratingDistribution: curRatingReady ? ratingDistribution : [],
      ratingTrend: curRatingReady ? [...ratingTrend] : [],
      responseIntegrity,
    }
  }
