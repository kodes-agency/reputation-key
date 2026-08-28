// Dashboard context — repository implementation (composition logic only)
// Per ADR-0007: does NOT directly query review/reply/metric tables.
// Delegates to ReviewStatsPort and MetricStatsPort facade ports.
// Wrapped in trace() for observability.

import type { DashboardRepository } from '../../application/ports/dashboard.repository'
import type {
  ReviewPeriodStats,
  ReviewStatsPort,
} from '../../application/ports/review-stats.port'
import type {
  MetricStatsPort,
  MetricSumRow,
} from '../../application/ports/metric-stats.port'
import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  EngagementFunnel,
  RecentReview,
  MetricKPIValue,
  MetricKPIPeriodEvidence,
} from '../../domain/types'
import { toDashboardReplyStatus } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { reviewId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

import { computeTrend, DEFAULT_RECENT_REVIEWS_LIMIT } from '../../application/utils'

/**
 * KPI assembly — single source for getKPIs/getKPIsForPortals (BQC-5.9 E4).
 * The two methods differ only in how they select the metric sums; the
 * current-vs-prior composition must not drift between them.
 */
function computeKpis(input: {
  currentReviews: ReviewPeriodStats
  priorReviews: ReviewPeriodStats | null
  currentMetrics: readonly MetricSumRow[]
  priorMetrics: readonly MetricSumRow[] | null
}): KPIs {
  const { currentReviews, priorReviews, currentMetrics, priorMetrics } = input
  const reviewComparisonAvailable = priorReviews !== null

  const curReviewCount = currentReviews.count
  const priorReviewCount = priorReviews?.count ?? 0
  const curAvgRating = currentReviews.avgRating
  const priorAvgRating = priorReviews?.avgRating ?? 0

  const missingEvidence = (): MetricKPIPeriodEvidence => ({
    state: 'updating',
    definitionVersionId: null,
    sampleCount: 0,
    minimumSample: null,
  })
  const evidenceFor = (row: MetricSumRow | undefined): MetricKPIPeriodEvidence => {
    if (!row) return missingEvidence()
    return {
      state: row.state === 'available' && row.total === null ? 'unavailable' : row.state,
      definitionVersionId: row.definitionVersionId,
      sampleCount: row.sampleCount,
      minimumSample: row.minimumSample,
    }
  }
  const metricKpi = (metricKey: string): MetricKPIValue => {
    const current = currentMetrics.find((row) => row.metricKey === metricKey)
    const prior = priorMetrics?.find((row) => row.metricKey === metricKey)
    const currentEvidence = evidenceFor(current)
    const priorEvidence = priorMetrics === null ? null : evidenceFor(prior)
    const value =
      currentEvidence.state === 'available' && current?.total !== null
        ? (current?.total ?? null)
        : null
    const priorValue =
      priorEvidence?.state === 'available' && prior?.total !== null
        ? (prior?.total ?? null)
        : null

    return {
      value,
      priorValue,
      trend:
        value !== null && priorValue !== null ? computeTrend(value, priorValue) : null,
      evidence: { current: currentEvidence, prior: priorEvidence },
    }
  }

  return {
    reviews: {
      value: curReviewCount,
      priorValue: priorReviewCount,
      trend: reviewComparisonAvailable
        ? computeTrend(curReviewCount, priorReviewCount)
        : null,
    },
    avgRating: {
      value: curAvgRating,
      priorValue: priorAvgRating,
      trend: reviewComparisonAvailable
        ? computeTrend(curAvgRating, priorAvgRating)
        : null,
    },
    scans: metricKpi('portal.scan'),
    feedback: metricKpi('portal.feedback'),
  }
}

export const createDashboardRepository = (
  reviewStats: ReviewStatsPort,
  metricStats: MetricStatsPort,
): DashboardRepository => ({
  async getRecentReviews(input): Promise<RecentReview[]> {
    return trace('dashboard.getRecentReviews', async () => {
      const { organizationId, propertyId, limit = DEFAULT_RECENT_REVIEWS_LIMIT } = input

      const rows = await reviewStats.getRecentReviews(organizationId, propertyId, limit)

      return rows.map((row) => ({
        id: reviewId(row.id),
        rating: row.rating,
        snippet: row.text ?? '',
        reviewedAt: row.reviewedAt,
        replyStatus: toDashboardReplyStatus(row.replyStatus).match(
          (s) => s,
          () => 'none' as const,
        ),
      }))
    })
  },

  async getKPIs(input): Promise<KPIs> {
    return trace('dashboard.getKPIs', async () => {
      const { organizationId, propertyId, startDate, endDate, comparisonPeriod } = input

      // Review stats for current and prior periods (parallel)
      const [currentReviews, priorReviews] = await Promise.all([
        reviewStats.getPeriodStats(organizationId, propertyId, startDate, endDate),
        comparisonPeriod
          ? reviewStats.getPeriodStats(
              organizationId,
              propertyId,
              comparisonPeriod.priorStartDate,
              comparisonPeriod.priorEndDate,
            )
          : Promise.resolve(null),
      ])

      // Metric sums for current and prior periods (parallel)
      // When portalId is set, use portal-scoped queries for scans/feedback
      const metricQuery = input.portalId
        ? (orgId: OrganizationId, propId: PropertyId, start: Date, end: Date) =>
            metricStats.getSumsByPortal(orgId, propId, input.portalId!, start, end)
        : (orgId: OrganizationId, propId: PropertyId, start: Date, end: Date) =>
            metricStats.getSumsByPeriod(orgId, propId, start, end)

      const [currentMetrics, priorMetrics] = await Promise.all([
        metricQuery(organizationId, propertyId, startDate, endDate),
        comparisonPeriod
          ? metricQuery(
              organizationId,
              propertyId,
              comparisonPeriod.priorStartDate,
              comparisonPeriod.priorEndDate,
            )
          : Promise.resolve(null),
      ])

      return computeKpis({ currentReviews, priorReviews, currentMetrics, priorMetrics })
    })
  },
  async getKPIsForPortals(input): Promise<KPIs> {
    return trace('dashboard.getKPIsForPortals', async () => {
      const {
        organizationId,
        propertyId,
        portalIds,
        startDate,
        endDate,
        comparisonPeriod,
      } = input

      // F054 NOTE: Review stats are property-level (no portalId filter on reviews).
      // This is correct — reviews are property-scoped. Metric stats are portal-scoped below.
      const [currentReviews, priorReviews] = await Promise.all([
        reviewStats.getPeriodStats(organizationId, propertyId, startDate, endDate),
        comparisonPeriod
          ? reviewStats.getPeriodStats(
              organizationId,
              propertyId,
              comparisonPeriod.priorStartDate,
              comparisonPeriod.priorEndDate,
            )
          : Promise.resolve(null),
      ])

      // Metric sums for current and prior periods across all assigned portals
      const metricQuery = (
        orgId: OrganizationId,
        propId: PropertyId,
        start: Date,
        end: Date,
      ) =>
        portalIds.length === 0
          ? Promise.resolve([] as readonly MetricSumRow[])
          : metricStats.getSumsByPortals(orgId, propId, portalIds, start, end)

      const [currentMetrics, priorMetrics] = await Promise.all([
        metricQuery(organizationId, propertyId, startDate, endDate),
        comparisonPeriod
          ? metricQuery(
              organizationId,
              propertyId,
              comparisonPeriod.priorStartDate,
              comparisonPeriod.priorEndDate,
            )
          : Promise.resolve(null),
      ])

      return computeKpis({ currentReviews, priorReviews, currentMetrics, priorMetrics })
    })
  },
  async getRatingDistribution(input): Promise<RatingDistribution> {
    return trace('dashboard.getRatingDistribution', async () => {
      const { organizationId, propertyId, startDate, endDate } = input

      const rows = await reviewStats.getRatingDistribution(
        organizationId,
        propertyId,
        startDate,
        endDate,
      )

      return rows
    })
  },
  async getRatingTrend(input): Promise<RatingTrendPoint[]> {
    return trace('dashboard.getRatingTrend', async () => {
      const { organizationId, propertyId, startDate, endDate } = input

      return [
        ...(await reviewStats.getRatingTrend(
          organizationId,
          propertyId,
          startDate,
          endDate,
        )),
      ]
    })
  },
  async getReviewVolume(input): Promise<ReviewVolumePoint[]> {
    return trace('dashboard.getReviewVolume', async () => {
      const { organizationId, propertyId, startDate, endDate } = input

      return [
        ...(await reviewStats.getReviewVolume(
          organizationId,
          propertyId,
          startDate,
          endDate,
        )),
      ]
    })
  },
  async getReplyPerformance(input): Promise<ReplyPerformance> {
    return trace('dashboard.getReplyPerformance', async () => {
      const { organizationId, propertyId, startDate, endDate } = input

      const { totalReviews, repliedCount, avgReplyHours } =
        await reviewStats.getReplyPerformance(
          organizationId,
          propertyId,
          startDate,
          endDate,
        )

      const replyRate = totalReviews > 0 ? (repliedCount / totalReviews) * 100 : 0

      return { replyRate: Math.round(replyRate * 100) / 100, avgReplyHours }
    })
  },
  async getEngagementFunnel(input): Promise<EngagementFunnel | null> {
    return trace('dashboard.getEngagementFunnel', async () => {
      const { organizationId, propertyId, portalId, startDate, endDate } = input

      // Use COUNT for all funnel steps (not SUM) — portal.rating values are 1-5,
      // summing them gives total stars, not number of ratings.
      const rows = await metricStats.getCountsByPortal(
        organizationId,
        propertyId,
        portalId,
        startDate,
        endDate,
      )

      const metricMap = new Map(rows.map((row) => [row.metricKey, row]))
      const availableCount = (metricKey: string): number | null => {
        const row = metricMap.get(metricKey)
        return row?.state === 'available' && row.count !== null ? row.count : null
      }
      const scans = availableCount('portal.scan')
      const ratings = availableCount('portal.rating')
      const reviewLinkClicks = availableCount('portal.review_link_click')

      if (scans === null || ratings === null || reviewLinkClicks === null) return null

      return {
        scans,
        ratings,
        reviewLinkClicks,
      }
    })
  },
})
