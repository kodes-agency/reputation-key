import { describe, expect, it } from 'vitest'
import { reviewId } from '#/shared/domain/ids'
import type { DashboardData, MetricKPIValue } from '../domain/dashboard-types'
import { hideReplyWorkflowWithoutAuthority } from './reply-workflow-redaction'

const COMPUTED_AT = new Date('2026-09-01T12:00:00.000Z')

function readyMetric(value: number): MetricKPIValue {
  const evidence = {
    state: 'ready' as const,
    definitionVersionId: 'metric-v1',
    sampleCount: value,
    minimumSample: 1,
  }
  return {
    value,
    priorValue: value,
    trend: 0,
    evidence: { current: evidence, prior: evidence },
  }
}

function dashboardWithReplyWorkflow(): DashboardData {
  return {
    kpis: {
      reviews: { value: 12, priorValue: 10, trend: 20 },
      avgRating: {
        value: 4.4,
        priorValue: 4.1,
        comparison: 0.3,
        sampleCount: 12,
        priorSampleCount: 10,
        evidence: {
          definitionVersionId: null,
          state: 'ready',
          verifiedThrough: COMPUTED_AT,
          latestActivity: COMPUTED_AT,
          computedAt: COMPUTED_AT,
          completeness: 1,
          availabilityReason: null,
          correctionHead: null,
          sampleCount: 12,
        },
      },
      scans: readyMetric(90),
      feedback: readyMetric(14),
    },
    ratingDistribution: [{ stars: 5, count: 8 }],
    ratingTrend: [{ date: '2026-09-01', avgRating: 4.4 }],
    reviewVolume: [{ date: '2026-09-01', count: 12 }],
    replyPerformance: { replyRate: 66.67, avgReplyHours: 12 },
    engagementFunnel: { scans: 90, ratings: 30, reviewLinkClicks: 9 },
    recentReviews: [
      {
        id: reviewId('review-published'),
        rating: 5,
        snippet: 'Lovely stay',
        reviewedAt: COMPUTED_AT,
        replyStatus: 'published',
      },
      {
        id: reviewId('review-drafted'),
        rating: 2,
        snippet: 'Noisy room',
        reviewedAt: COMPUTED_AT,
        replyStatus: 'draft',
      },
    ],
  }
}

describe('hideReplyWorkflowWithoutAuthority', () => {
  it('zeroes reply metrics and hides each review reply state without reply.manage', () => {
    const dashboard = dashboardWithReplyWorkflow()
    const before = structuredClone(dashboard)

    const redacted = hideReplyWorkflowWithoutAuthority(false, dashboard)

    // Everything else, KPIs included, reaches the caller as it was.
    expect(redacted).toEqual({
      ...before,
      replyPerformance: { replyRate: 0, avgReplyHours: null },
      recentReviews: before.recentReviews.map((review) => ({
        ...review,
        replyStatus: 'none',
      })),
    })
    expect(dashboard).toEqual(before)
  })

  it('returns the dashboard untouched for a caller with reply.manage', () => {
    const dashboard = dashboardWithReplyWorkflow()

    expect(hideReplyWorkflowWithoutAuthority(true, dashboard)).toBe(dashboard)
  })
})
