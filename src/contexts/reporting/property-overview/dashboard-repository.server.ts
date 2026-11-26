// Compose facade reads without querying Review and Reply tables directly
// (ADR 0007).

import type { DashboardRepository } from './dashboard-repository.port.server'
import type { ReviewPeriodStats, ReviewStatsPort } from './review-stats.port.server'
import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  RecentReview,
} from '../domain/dashboard-types'
import { toDashboardReplyStatus } from '../domain/dashboard-types'
import { reviewId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

import {
  computeTrend,
  DEFAULT_RECENT_REVIEWS_LIMIT,
  ratingComparison,
} from '../portal-results/time-range.server'

/**
 * KPI assembly — the current-vs-prior composition for getKPIs.
 */
function computeKpis(input: {
  currentReviews: ReviewPeriodStats
  priorReviews: ReviewPeriodStats | null
  currentPeriodEnd: Date
}): KPIs {
  const { currentReviews, priorReviews } = input
  const reviewComparisonAvailable = priorReviews !== null

  const curReviewCount = currentReviews.count
  const priorReviewCount = priorReviews?.count ?? 0
  const curAvgRating = currentReviews.avgRating
  const priorAvgRating = priorReviews?.avgRating ?? null

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
      comparison: reviewComparisonAvailable
        ? ratingComparison(curAvgRating, curReviewCount, priorAvgRating, priorReviewCount)
        : null,
      sampleCount: curReviewCount,
      priorSampleCount: priorReviewCount,
      evidence: {
        definitionVersionId: null,
        state: curReviewCount === 0 ? 'insufficient_data' : 'ready',
        verifiedThrough: input.currentPeriodEnd,
        latestActivity: null,
        computedAt: input.currentPeriodEnd,
        completeness: 1,
        availabilityReason: null,
        correctionHead: null,
        sampleCount: curReviewCount,
      },
    },
  }
}

export const createDashboardRepository = (
  reviewStats: ReviewStatsPort,
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

      return computeKpis({
        currentReviews,
        priorReviews,
        currentPeriodEnd: endDate,
      })
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
})
