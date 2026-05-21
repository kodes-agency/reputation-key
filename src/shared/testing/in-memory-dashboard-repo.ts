// Dashboard context — in-memory repository for unit tests

import type { DashboardRepository } from '#/contexts/dashboard/application/ports/dashboard.repository'
import type {
  KPIs,
  RatingDistribution,
  RatingTrendPoint,
  ReviewVolumePoint,
  ReplyPerformance,
  EngagementFunnel,
  RecentReview,
} from '#/contexts/dashboard/domain/types'

export function createInMemoryDashboardRepository(
  overrides: Partial<Record<string, unknown>> = {},
): DashboardRepository & { calls: string[] } {
  const calls: string[] = []

  const defaultKPIs: KPIs = {
    reviews: { value: 10, priorValue: 8, trend: 25 },
    avgRating: { value: 4.5, priorValue: 4.2, trend: 7 },
    scans: { value: 100, priorValue: 80, trend: 25 },
    feedback: { value: 20, priorValue: 15, trend: 33 },
  }

  return {
    calls,
    async getKPIs() {
      calls.push('getKPIs')
      return (overrides.getKPIs as KPIs | undefined) ?? defaultKPIs
    },
    async getRatingDistribution() {
      calls.push('getRatingDistribution')
      return (
        (overrides.getRatingDistribution as RatingDistribution | undefined) ??
        [1, 2, 3, 4, 5].map((stars) => ({ stars, count: stars === 5 ? 5 : 1 }))
      )
    },
    async getRatingTrend() {
      calls.push('getRatingTrend')
      return (
        (overrides.getRatingTrend as RatingTrendPoint[] | undefined) ?? [
          { date: '2026-05-19', avgRating: 4.2 },
          { date: '2026-05-20', avgRating: 4.5 },
        ]
      )
    },
    async getReviewVolume() {
      calls.push('getReviewVolume')
      return (
        (overrides.getReviewVolume as ReviewVolumePoint[] | undefined) ?? [
          { date: '2026-05-19', count: 3 },
          { date: '2026-05-20', count: 5 },
        ]
      )
    },
    async getReplyPerformance() {
      calls.push('getReplyPerformance')
      return (
        (overrides.getReplyPerformance as ReplyPerformance | undefined) ?? {
          replyRate: 66.67,
          avgReplyHours: 12,
        }
      )
    },
    async getEngagementFunnel() {
      calls.push('getEngagementFunnel')
      return (
        (overrides.getEngagementFunnel as EngagementFunnel | undefined) ?? {
          scans: 100,
          ratings: 40,
          reviewLinkClicks: 10,
        }
      )
    },
    async getRecentReviews() {
      calls.push('getRecentReviews')
      return (
        (overrides.getRecentReviews as RecentReview[] | undefined) ?? [
          { id: 'r1', rating: 5, snippet: 'Great!', reviewedAt: new Date(), replyStatus: 'none' },
        ]
      )
    },
  }
}
