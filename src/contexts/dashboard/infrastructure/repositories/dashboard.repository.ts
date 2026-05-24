// Dashboard context — repository implementation (composition logic only)
// Per ADR-0007: does NOT directly query review/reply/metric tables.
// Delegates to ReviewStatsPort and MetricStatsPort facade ports.
// Wrapped in trace() for observability.

import type { DashboardRepository } from '../../application/ports/dashboard.repository'
import type { ReviewStatsPort } from '../../application/ports/review-stats.port'
import type { MetricStatsPort } from '../../application/ports/metric-stats.port'
import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  EngagementFunnel,
  RecentReview,
} from '../../domain/types'
import { toDashboardReplyStatus } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { reviewId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

/** Compute trend percentage. Returns null when prior is 0 or result is not finite. */
function trend(current: number, prior: number): number | null {
  if (prior === 0) return null
  const result = ((current - prior) / prior) * 100
  return Number.isFinite(result) ? Math.round(result) : null
}

export function createDashboardRepository(
  reviewStats: ReviewStatsPort,
  metricStats: MetricStatsPort,
): DashboardRepository {
  return {
    async getRecentReviews(input): Promise<RecentReview[]> {
      return trace('dashboard.getRecentReviews', async () => {
        const { organizationId, propertyId, limit = 5 } = input

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
        const {
          organizationId,
          propertyId,
          startDate,
          endDate,
          priorStartDate,
          priorEndDate,
        } = input

        // Review stats for current and prior periods (parallel)
        const [currentReviews, priorReviews] = await Promise.all([
          reviewStats.getPeriodStats(organizationId, propertyId, startDate, endDate),
          reviewStats.getPeriodStats(
            organizationId,
            propertyId,
            priorStartDate,
            priorEndDate,
          ),
        ])

        const curReviewCount = currentReviews.count
        const priorReviewCount = priorReviews.count
        const curAvgRating = currentReviews.avgRating
        const priorAvgRating = priorReviews.avgRating

        // Metric sums for current and prior periods (parallel)
        // When portalId is set, use portal-scoped queries for scans/feedback
        const metricQuery = input.portalId
          ? (orgId: OrganizationId, propId: PropertyId, start: Date, end: Date) =>
              metricStats.getSumsByPortal(orgId, propId, input.portalId!, start, end)
          : (orgId: OrganizationId, propId: PropertyId, start: Date, end: Date) =>
              metricStats.getSumsByPeriod(orgId, propId, start, end)

        const [currentMetrics, priorMetrics] = await Promise.all([
          metricQuery(organizationId, propertyId, startDate, endDate),
          metricQuery(organizationId, propertyId, priorStartDate, priorEndDate),
        ])

        const toMap = (rows: readonly { metricKey: string; total: number }[]) =>
          new Map(rows.map((r) => [r.metricKey, r.total]))

        const curMetricsMap = toMap(currentMetrics)
        const priorMetricsMap = toMap(priorMetrics)

        const curScans = curMetricsMap.get('portal.scan') ?? 0
        const priorScans = priorMetricsMap.get('portal.scan') ?? 0
        const curFeedback = curMetricsMap.get('portal.feedback') ?? 0
        const priorFeedback = priorMetricsMap.get('portal.feedback') ?? 0

        return {
          reviews: {
            value: curReviewCount,
            priorValue: priorReviewCount,
            trend: trend(curReviewCount, priorReviewCount),
          },
          avgRating: {
            value: curAvgRating,
            priorValue: priorAvgRating,
            trend: trend(curAvgRating, priorAvgRating),
          },
          scans: {
            value: curScans,
            priorValue: priorScans,
            trend: trend(curScans, priorScans),
          },
          feedback: {
            value: curFeedback,
            priorValue: priorFeedback,
            trend: trend(curFeedback, priorFeedback),
          },
        }
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
    async getEngagementFunnel(input): Promise<EngagementFunnel> {
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

        const metricMap = new Map(rows.map((r) => [r.metricKey, r.count]))

        return {
          scans: metricMap.get('portal.scan') ?? 0,
          ratings: metricMap.get('portal.rating') ?? 0,
          reviewLinkClicks: metricMap.get('portal.review_link_click') ?? 0,
        }
      })
    },
  }
}
