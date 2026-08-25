// Dashboard context — getPortalAnalytics use case unit tests
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPortalAnalytics } from './get-portal-analytics'
import type { PortalMetricsPort } from '../ports/portal-metrics.port'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import type { PortalAnalyticsData } from '../../domain/types'

// Fixed time to prevent midnight-boundary flakiness in date range calculations
beforeEach(() => vi.setSystemTime(new Date('2025-06-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

const ORG = organizationId('org-test')
const PROP = propertyId('a0000000-0000-0000-0000-000000000001')
const PORT = portalId('b0000000-0000-0000-0000-000000000001')

function createFakePortalMetrics(overrides?: {
  kpiSums?: ReturnType<PortalMetricsPort['getPortalKpiSums']> extends Promise<infer T>
    ? T
    : never
  ratingDistribution?: ReturnType<
    PortalMetricsPort['getPortalRatingDistribution']
  > extends Promise<infer T>
    ? T
    : never
  ratingTrend?: ReturnType<PortalMetricsPort['getPortalRatingTrend']> extends Promise<
    infer T
  >
    ? T
    : never
  evidence?: Awaited<ReturnType<PortalMetricsPort['getPortalMetricEvidence']>>
}): PortalMetricsPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getPortalKpiSums() {
      calls.push('getPortalKpiSums')
      return (
        overrides?.kpiSums ?? [
          { metricKey: 'portal.scan', total: 100, count: 10 },
          { metricKey: 'portal.feedback', total: 20, count: 5 },
          { metricKey: 'portal.rating', total: 22, count: 5 },
          { metricKey: 'portal.review_link_click', total: 8, count: 3 },
        ]
      )
    },
    async getPortalRatingDistribution() {
      calls.push('getPortalRatingDistribution')
      return (
        overrides?.ratingDistribution ?? [
          { stars: 5, count: 6 },
          { stars: 4, count: 3 },
        ]
      )
    },
    async getPortalRatingTrend() {
      calls.push('getPortalRatingTrend')
      return (
        overrides?.ratingTrend ?? [
          { date: '2026-05-19', avgRating: 4.2 },
          { date: '2026-05-20', avgRating: 4.5 },
        ]
      )
    },
    async getPortalMetricEvidence() {
      calls.push('getPortalMetricEvidence')
      return overrides?.evidence ?? readyEvidence()
    },
  }
}

function metricEvidence(definitionVersionId: string) {
  const computedAt = new Date('2025-06-15T12:00:00.000Z')
  return {
    definitionVersionId,
    state: 'ready' as const,
    verifiedThrough: computedAt,
    latestActivity: new Date('2025-06-15T11:00:00.000Z'),
    computedAt,
    completeness: 1,
    availabilityReason: null,
    correctionHead: null,
  }
}

function readyEvidence() {
  return {
    scans: metricEvidence('scan-version'),
    privateRatings: metricEvidence('rating-version'),
    privateFeedback: metricEvidence('feedback-version'),
    reviewLinkClicks: metricEvidence('click-version'),
  }
}

function createFakeResponseIntegrity() {
  return {
    getPortalResponseIntegritySummary: vi.fn(async () => ({
      accepted: 8,
      filteredAutomatically: 1,
      underReview: 1,
      total: 10,
    })),
  }
}

describe('getPortalAnalytics (use case)', () => {
  it('composes portal KPI sums into PortalAnalyticsData', async () => {
    const metrics = createFakePortalMetrics()
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      responseIntegrity: createFakeResponseIntegrity(),
    })
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 86_400_000)

    const result: PortalAnalyticsData = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: start,
      endDate: now,
      timeRange: '30d',
      propertyTimezone: 'UTC',
    })

    // KPIs have correct values from fake data
    expect(result.kpis.scans.value).toBe(100)
    expect(result.kpis.scans.priorValue).toBe(100) // Same fake data for prior
    expect(result.kpis.feedback.value).toBe(20)
    expect(result.kpis.avgRating.value).toBe(4.4) // 22/5 = 4.4
    expect(result.kpis.avgRating.sampleCount).toBe(5)
    expect(result.kpis.avgRating.comparison).toBeNull()
    expect(result.kpis.avgRating.evidence).toMatchObject({
      state: 'ready',
      sampleCount: 5,
    })
    expect(result.period).toEqual({
      startAt: start,
      endAt: now,
      timezone: 'UTC',
    })

    expect(result.engagementFunnel).toEqual({
      scans: 100,
      ratings: 5,
      reviewLinkClicks: 8,
    })

    // Rating data from metrics port
    expect(result.ratingDistribution).toHaveLength(2)
    expect(result.ratingTrend).toHaveLength(2)
    expect(metrics.calls).toContain('getPortalKpiSums')
    expect(result.responseIntegrity).toEqual({
      accepted: 8,
      filteredAutomatically: 1,
      underReview: 1,
      total: 10,
    })
  })

  it('handles zero metric values gracefully', async () => {
    const metrics = createFakePortalMetrics({
      kpiSums: [
        { metricKey: 'portal.scan', total: 0, count: 0 },
        { metricKey: 'portal.feedback', total: 0, count: 0 },
        { metricKey: 'portal.rating', total: 0, count: 0 },
        { metricKey: 'portal.review_link_click', total: 0, count: 0 },
      ],
    })
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      responseIntegrity: createFakeResponseIntegrity(),
    })
    const now = new Date()

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(0),
      endDate: now,
      timeRange: 'all',
      propertyTimezone: 'UTC',
    })

    expect(result.kpis.scans.value).toBe(0)
    expect(result.kpis.scans.trend).toBeNull() // prior is 0 → null trend
    expect(result.kpis.avgRating.value).toBeNull()
    expect(result.kpis.avgRating.sampleCount).toBe(0)
    expect(result.kpis.avgRating.evidence.state).toBe('insufficient_data')
  })

  it('computes trends when prior period has different values', async () => {
    let callCount = 0
    const metrics = createFakePortalMetrics()
    // Build dynamic metrics port that returns different values based on call count
    const dynamicMetrics: PortalMetricsPort & { calls: string[] } = {
      ...metrics,
      async getPortalKpiSums() {
        metrics.calls.push('getPortalKpiSums')
        callCount++
        if (callCount === 1) {
          return [
            { metricKey: 'portal.scan', total: 200, count: 20 },
            { metricKey: 'portal.feedback', total: 40, count: 10 },
            { metricKey: 'portal.rating', total: 45, count: 10 },
            { metricKey: 'portal.review_link_click', total: 16, count: 6 },
          ]
        }
        return [
          { metricKey: 'portal.scan', total: 100, count: 10 },
          { metricKey: 'portal.feedback', total: 20, count: 5 },
          { metricKey: 'portal.rating', total: 40, count: 10 },
          { metricKey: 'portal.review_link_click', total: 8, count: 3 },
        ]
      },
    }

    const analytics = getPortalAnalytics({
      portalMetrics: dynamicMetrics,
      responseIntegrity: createFakeResponseIntegrity(),
    })
    const now = new Date()
    const start = new Date(now.getTime() - 30 * 86_400_000)

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: start,
      endDate: now,
      timeRange: '30d',
      propertyTimezone: 'UTC',
    })

    // Trend: (200-100)/100 * 100 = 100%
    expect(result.kpis.scans.value).toBe(200)
    expect(result.kpis.scans.priorValue).toBe(100)
    expect(result.kpis.scans.trend).toBe(100)

    // Private-rating comparison is an absolute star delta, never a percentage.
    expect(result.kpis.avgRating.value).toBe(4.5)
    expect(result.kpis.avgRating.priorValue).toBe(4)
    expect(result.kpis.avgRating.sampleCount).toBe(10)
    expect(result.kpis.avgRating.priorSampleCount).toBe(10)
    expect(result.kpis.avgRating.comparison).toBe(0.5)
  })

  it('reads the prior window in the Property-local calendar', async () => {
    const metrics = createFakePortalMetrics()
    const getPortalKpiSums = vi.fn(metrics.getPortalKpiSums)
    const analytics = getPortalAnalytics({
      portalMetrics: { ...metrics, getPortalKpiSums },
      responseIntegrity: createFakeResponseIntegrity(),
    })
    const startDate = new Date('2026-02-18T17:00:00.000Z')
    const endDate = new Date('2026-03-20T16:00:00.000Z')

    await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate,
      endDate,
      timeRange: '30d',
      propertyTimezone: 'America/New_York',
    })

    expect(getPortalKpiSums).toHaveBeenNthCalledWith(
      2,
      ORG,
      PROP,
      PORT,
      new Date('2026-01-19T17:00:00.000Z'),
      startDate,
    )
  })

  it('skips the prior-period query for "all" and reports no trend', async () => {
    const metrics = createFakePortalMetrics()
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      responseIntegrity: createFakeResponseIntegrity(),
    })

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(0),
      endDate: new Date(),
      timeRange: 'all',
      propertyTimezone: 'UTC',
    })

    // ONE kpi-sums query: 'all' scans from epoch, and the prior call used to
    // receive byte-identical arguments — a duplicate full scan per page load.
    expect(metrics.calls.filter((call) => call === 'getPortalKpiSums')).toHaveLength(1)

    // Every trend is null (an em dash in the cards), never a fabricated 0%.
    expect(result.kpis.scans.trend).toBeNull()
    expect(result.kpis.avgRating.comparison).toBeNull()
    expect(result.kpis.feedback.trend).toBeNull()
    expect(result.kpis.reviewLinkClicks.trend).toBeNull()

    // Current-period values are unaffected by the skipped prior query.
    expect(result.kpis.scans.value).toBe(100)
    expect(result.kpis.scans.priorValue).toBeNull()
  })

  it('derives one correction-aware engagement funnel from governed rows', async () => {
    const metrics = createFakePortalMetrics()
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      responseIntegrity: createFakeResponseIntegrity(),
    })
    const now = new Date()

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(0),
      endDate: now,
      timeRange: 'all',
      propertyTimezone: 'UTC',
    })

    expect(result.engagementFunnel).toEqual({
      scans: 100,
      ratings: 5,
      reviewLinkClicks: 8,
    })
  })

  it('never turns updating or unavailable governed data into zero', async () => {
    const metrics = createFakePortalMetrics({
      kpiSums: [],
      evidence: {
        ...readyEvidence(),
        scans: {
          ...metricEvidence('scan-version'),
          state: 'updating',
          verifiedThrough: null,
          completeness: 0.5,
          availabilityReason: 'consumer_receipt_pending',
        },
        privateRatings: {
          ...metricEvidence('rating-version'),
          state: 'unavailable',
          verifiedThrough: null,
          completeness: 0,
          availabilityReason: 'invalid_governed_reading',
        },
      },
    })
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      responseIntegrity: createFakeResponseIntegrity(),
    })

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date('2025-05-16T12:00:00Z'),
      endDate: new Date('2025-06-15T12:00:00Z'),
      timeRange: '30d',
      propertyTimezone: 'UTC',
    })

    expect(result.kpis.scans.value).toBeNull()
    expect(result.kpis.scans.evidence.state).toBe('updating')
    expect(result.kpis.avgRating.value).toBeNull()
    expect(result.kpis.avgRating.evidence.state).toBe('temporarily_unavailable')
    expect(result.engagementFunnel).toBeNull()
  })
})
