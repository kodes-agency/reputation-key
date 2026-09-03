// Shared testing utility — in-memory dashboard repository for unit tests
import type { DashboardRepository } from '#/contexts/dashboard/application/ports/dashboard.repository'
import type {
  KPIs,
  EngagementFunnel,
  MetricKPIValue,
} from '#/contexts/dashboard/domain/types'
import { reviewId } from '#/shared/domain/ids'

export function createInMemoryDashboardRepository(): DashboardRepository & {
  calls: string[]
  /** Override the return value of getKPIs and getKPIsForPortals. */
  kpisOverride?: KPIs
  /** Override the return value of getEngagementFunnel. */
  engagementFunnelOverride?: EngagementFunnel
} {
  const calls: string[] = []

  const readyMetricKpi = (
    value: number,
    priorValue: number,
    trend: number | null,
  ): MetricKPIValue => ({
    value,
    priorValue,
    trend,
    evidence: {
      current: {
        state: 'ready',
        definitionVersionId: 'in-memory-current-version',
        sampleCount: Math.max(value, 1),
        minimumSample: 1,
      },
      prior: {
        state: 'ready',
        definitionVersionId: 'in-memory-prior-version',
        sampleCount: Math.max(priorValue, 1),
        minimumSample: 1,
      },
    },
  })

  const defaultKPIs: KPIs = {
    reviews: { value: 10, priorValue: 8, trend: 25 },
    avgRating: {
      value: 4.5,
      priorValue: 4.2,
      comparison: 0.3,
      sampleCount: 10,
      priorSampleCount: 10,
      evidence: {
        definitionVersionId: null,
        state: 'ready',
        verifiedThrough: new Date('2026-05-20T12:00:00.000Z'),
        latestActivity: new Date('2026-05-20T10:00:00.000Z'),
        computedAt: new Date('2026-05-20T12:00:00.000Z'),
        completeness: 1,
        availabilityReason: null,
        correctionHead: null,
        sampleCount: 10,
      },
    },
    scans: readyMetricKpi(100, 80, 25),
    feedback: readyMetricKpi(20, 15, 33),
  }

  // Use a mutable container so tests can set kpisOverride and engagementFunnelOverride
  // after creation and have the methods pick up the new values.
  const state: {
    kpisOverride?: KPIs
    engagementFunnelOverride?: EngagementFunnel
  } = {}

  const withoutComparison = (kpis: KPIs): KPIs => ({
    reviews: { ...kpis.reviews, priorValue: 0, trend: null },
    avgRating: {
      ...kpis.avgRating,
      priorValue: null,
      comparison: null,
      priorSampleCount: 0,
    },
    scans: {
      ...kpis.scans,
      priorValue: null,
      trend: null,
      evidence: { ...kpis.scans.evidence, prior: null },
    },
    feedback: {
      ...kpis.feedback,
      priorValue: null,
      trend: null,
      evidence: { ...kpis.feedback.evidence, prior: null },
    },
  })

  const repo: DashboardRepository = {
    async getKPIs(input) {
      calls.push('getKPIs')
      const kpis = state.kpisOverride ?? defaultKPIs
      return input.comparisonPeriod ? kpis : withoutComparison(kpis)
    },
    async getKPIsForPortals(input) {
      calls.push('getKPIsForPortals')
      const kpis = state.kpisOverride ?? defaultKPIs
      return input.comparisonPeriod ? kpis : withoutComparison(kpis)
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
