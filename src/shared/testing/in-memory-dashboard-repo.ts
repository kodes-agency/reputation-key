// Shared testing utility — in-memory dashboard repository for unit tests
import type { DashboardRepository } from '#/contexts/dashboard/application/ports/dashboard.repository'
import type { KPIs, EngagementFunnel } from '#/contexts/dashboard/domain/types'
import { reviewId } from '#/shared/domain/ids'

export function createInMemoryDashboardRepository(): DashboardRepository & {
  calls: string[]
  /** Override the return value of getKPIs and getKPIsForPortals. */
  kpisOverride?: KPIs
  /** Override the return value of getEngagementFunnel. */
  engagementFunnelOverride?: EngagementFunnel
} {
  const calls: string[] = []

  const defaultKPIs: KPIs = {
    reviews: { value: 10, priorValue: 8, trend: 25 },
    avgRating: { value: 4.5, priorValue: 4.2, trend: 7 },
    scans: { value: 100, priorValue: 80, trend: 25 },
    feedback: { value: 20, priorValue: 15, trend: 33 },
  }

  // Use a mutable container so tests can set kpisOverride and engagementFunnelOverride
  // after creation and have the methods pick up the new values.
  const state: {
    kpisOverride?: KPIs
    engagementFunnelOverride?: EngagementFunnel
  } = {}

  const repo: DashboardRepository = {
    async getKPIs() {
      calls.push('getKPIs')
      return state.kpisOverride ?? defaultKPIs
    },
    async getKPIsForPortals() {
      calls.push('getKPIsForPortals')
      return state.kpisOverride ?? defaultKPIs
    },
    async getRatingDistribution() {
      calls.push('getRatingDistribution')
      return [1, 2, 3, 4, 5].map((stars) => ({ stars, count: stars === 5 ? 5 : 1 }))
    },
    async getRatingTrend() {
      calls.push('getRatingTrend')
      return [
        { date: '2026-05-19', avgRating: 4.2 },
        { date: '2026-05-20', avgRating: 4.5 },
      ]
    },
    async getReviewVolume() {
      calls.push('getReviewVolume')
      return [
        { date: '2026-05-19', count: 3 },
        { date: '2026-05-20', count: 5 },
      ]
    },
    async getReplyPerformance() {
      calls.push('getReplyPerformance')
      return { replyRate: 66.67, avgReplyHours: 12 }
    },
    async getEngagementFunnel() {
      calls.push('getEngagementFunnel')
      return (
        state.engagementFunnelOverride ?? {
          scans: 100,
          ratings: 40,
          reviewLinkClicks: 10,
        }
      )
    },
    async getRecentReviews() {
      calls.push('getRecentReviews')
      return [
        {
          id: reviewId('r1'),
          rating: 5,
          snippet: 'Great!',
          reviewedAt: new Date(),
          replyStatus: 'none' as const,
        },
      ]
    },
  }

  // Return merged object with mutable overrides via getters/setters
  return {
    ...repo,
    calls,
    get kpisOverride() {
      return state.kpisOverride
    },
    set kpisOverride(v: KPIs | undefined) {
      state.kpisOverride = v
    },
    get engagementFunnelOverride() {
      return state.engagementFunnelOverride
    },
    set engagementFunnelOverride(v: EngagementFunnel | undefined) {
      state.engagementFunnelOverride = v
    },
  }
}
