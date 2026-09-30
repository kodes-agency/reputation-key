// Dashboard context — getPortalAnalytics use case unit tests
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPortalAnalytics } from './get-portal-analytics'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import type { PortalAnalyticsData } from '../../domain/dashboard-types'
import { METRIC_VERSION_IDS, findMetricVersionById } from '../../domain/metric-registry'
import type {
  MetricPortalMetricEvidenceSet,
  MetricPortalRatingTrendPoint,
  PortalAnalyticsRepository,
  PortalMetricSumRow,
  PortalRatingBucket,
} from '../ports/portal-analytics.repository'

// Fixed time to prevent midnight-boundary flakiness in date range calculations.
// It sits after the day qualified scans began counting (2026-08-01), so a 30-day
// window and its prior window are both fully covered by that measure.
beforeEach(() => vi.setSystemTime(new Date('2026-10-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

const ORG = organizationId('org-test')
const PROP = propertyId('a0000000-0000-0000-0000-000000000001')
const PORT = portalId('b0000000-0000-0000-0000-000000000001')

function createFakePortalMetrics(overrides?: {
  kpiSums?: readonly PortalMetricSumRow[]
  ratingDistribution?: readonly PortalRatingBucket[]
  ratingTrend?: readonly MetricPortalRatingTrendPoint[]
  evidence?: MetricPortalMetricEvidenceSet
}): PortalAnalyticsRepository & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getPortalKpiSums() {
      calls.push('getPortalKpiSums')
      return (
        overrides?.kpiSums ?? [
          { metricKey: 'portal.qualified_scan', total: 100, count: 10 },
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

function createUnusedPortalLifetime() {
  return { get: vi.fn(async () => null) }
}

function emptyPortalLifetimeAggregate() {
  const now = new Date('2025-06-15T12:00:00.000Z')
  return {
    organizationId: ORG,
    propertyId: PROP,
    portalId: PORT,
    definitionVersionIds: {
      qualifiedScans: 'qualified-scan-version',
      privateRatings: 'private-rating-version',
      privateFeedback: 'private-feedback-version',
      destinationSelections: 'destination-selection-version',
    },
    values: {
      qualifiedScanCount: 0,
      privateRatingCount: 0,
      privateRatingSum: 0,
      privateRating1Count: 0,
      privateRating2Count: 0,
      privateRating3Count: 0,
      privateRating4Count: 0,
      privateRating5Count: 0,
      privateFeedbackCount: 0,
      googleReviewSelectionCount: 0,
      secondaryLinkSelectionCount: 0,
    },
    sealedThroughLocalDate: null,
    projectionRevision: 1,
    lastRebuiltAt: now,
    lastSealedAt: null,
  } as const
}

describe('getPortalAnalytics (use case)', () => {
  it('composes portal KPI sums into PortalAnalyticsData', async () => {
    const metrics = createFakePortalMetrics()
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: createUnusedPortalLifetime(),
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
      qualifiedScans: 100,
      ratings: 5,
      googleOpens: 8,
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
        { metricKey: 'portal.qualified_scan', total: 0, count: 0 },
        { metricKey: 'portal.feedback', total: 0, count: 0 },
        { metricKey: 'portal.rating', total: 0, count: 0 },
        { metricKey: 'portal.review_link_click', total: 0, count: 0 },
      ],
    })
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: { get: vi.fn(async () => emptyPortalLifetimeAggregate()) },
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
    // Return different values based on call count.
    const dynamicMetrics: PortalAnalyticsRepository & { calls: string[] } = {
      ...metrics,
      async getPortalKpiSums() {
        metrics.calls.push('getPortalKpiSums')
        callCount++
        if (callCount === 1) {
          return [
            { metricKey: 'portal.qualified_scan', total: 200, count: 20 },
            { metricKey: 'portal.feedback', total: 40, count: 10 },
            { metricKey: 'portal.rating', total: 45, count: 10 },
            { metricKey: 'portal.review_link_click', total: 16, count: 6 },
          ]
        }
        return [
          { metricKey: 'portal.qualified_scan', total: 100, count: 10 },
          { metricKey: 'portal.feedback', total: 20, count: 5 },
          { metricKey: 'portal.rating', total: 40, count: 10 },
          { metricKey: 'portal.review_link_click', total: 8, count: 3 },
        ]
      },
    }

    const analytics = getPortalAnalytics({
      portalMetrics: dynamicMetrics,
      portalLifetime: createUnusedPortalLifetime(),
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
      portalLifetime: createUnusedPortalLifetime(),
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

  it('serves All Time from the anonymous lifetime aggregate without inventing a trend', async () => {
    const metrics = createFakePortalMetrics()
    const lifetimeGet = vi.fn(async () => ({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      definitionVersionIds: {
        qualifiedScans: 'qualified-scan-version',
        privateRatings: 'private-rating-version',
        privateFeedback: 'private-feedback-version',
        destinationSelections: 'destination-selection-version',
      },
      values: {
        qualifiedScanCount: 42,
        privateRatingCount: 5,
        privateRatingSum: 20,
        privateRating1Count: 0,
        privateRating2Count: 1,
        privateRating3Count: 1,
        privateRating4Count: 0,
        privateRating5Count: 3,
        privateFeedbackCount: 7,
        googleReviewSelectionCount: 9,
        secondaryLinkSelectionCount: 2,
      },
      sealedThroughLocalDate: '2026-07-01',
      projectionRevision: 12,
      lastRebuiltAt: new Date('2026-08-14T09:00:00.000Z'),
      lastSealedAt: new Date('2026-08-01T08:00:00.000Z'),
    }))
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      responseIntegrity: createFakeResponseIntegrity(),
      portalLifetime: { get: lifetimeGet },
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

    expect(lifetimeGet).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
    })
    expect(metrics.calls).toEqual([])

    expect(result.kpis.scans.value).toBe(42)
    expect(result.kpis.avgRating.value).toBe(4)
    expect(result.kpis.avgRating.sampleCount).toBe(5)
    expect(result.kpis.feedback.value).toBe(7)
    // 9 Google selections; the 2 secondary-link selections are not Google opens.
    expect(result.kpis.googleOpens.value).toBe(9)
    expect(result.ratingDistribution).toEqual([
      { stars: 1, count: 0 },
      { stars: 2, count: 1 },
      { stars: 3, count: 1 },
      { stars: 4, count: 0 },
      { stars: 5, count: 3 },
    ])

    // Lifetime totals are absolute. They contain no date series and can never
    // be treated as either side of a time-window comparison.
    expect(result.kpis.scans.trend).toBeNull()
    expect(result.kpis.avgRating.comparison).toBeNull()
    expect(result.kpis.feedback.trend).toBeNull()
    expect(result.kpis.googleOpens.trend).toBeNull()
    expect(result.ratingTrend).toEqual([])

    expect(result.kpis.scans.priorValue).toBeNull()
    expect(result.lifetimeReconciliation).toEqual({
      state: 'reconciled',
      projectionRevision: 12,
      sealedThroughLocalDate: '2026-07-01',
      lastRebuiltAt: new Date('2026-08-14T09:00:00.000Z'),
      lastSealedAt: new Date('2026-08-01T08:00:00.000Z'),
    })
  })

  it('exposes an uninitialized lifetime projection without presenting missing totals as zero', async () => {
    const metrics = createFakePortalMetrics()
    const lifetimeGet = vi.fn(async () => null)
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: { get: lifetimeGet },
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

    expect(metrics.calls).toEqual([])
    expect(result.lifetimeReconciliation).toMatchObject({
      state: 'not_initialized',
      projectionRevision: null,
    })
    expect(result.kpis.scans.value).toBeNull()
    expect(result.kpis.feedback.value).toBeNull()
    expect(result.kpis.googleOpens.value).toBeNull()
    expect(result.kpis.avgRating.value).toBeNull()
    expect(result.ratingTrend).toEqual([])
  })

  it('derives one correction-aware engagement funnel from governed rows', async () => {
    const metrics = createFakePortalMetrics()
    const analytics = getPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
    })
    const now = new Date()

    const result = await analytics({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(now.getTime() - 30 * 86_400_000),
      endDate: now,
      timeRange: '30d',
      propertyTimezone: 'UTC',
    })

    expect(result.engagementFunnel).toEqual({
      qualifiedScans: 100,
      ratings: 5,
      googleOpens: 8,
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
      portalLifetime: createUnusedPortalLifetime(),
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

// ── Results measures tell the truth (R1) ──

type WindowSums = Readonly<{
  scans?: number
  ratingCount?: number
  ratingTotal?: number
  googleOpens?: number
  feedback?: number
}>

function windowSums(values: WindowSums): readonly PortalMetricSumRow[] {
  const ratingCount = values.ratingCount ?? 0
  return [
    {
      metricKey: 'portal.qualified_scan',
      total: values.scans ?? 0,
      count: values.scans ?? 0,
    },
    {
      metricKey: 'portal.feedback',
      total: values.feedback ?? 0,
      count: values.feedback ?? 0,
    },
    { metricKey: 'portal.rating', total: values.ratingTotal ?? 0, count: ratingCount },
    {
      metricKey: 'portal.review_link_click',
      total: values.googleOpens ?? 0,
      count: values.googleOpens ?? 0,
    },
  ]
}

/** Current window first, prior window second, like the use case asks. */
function metricsForWindows(
  current: WindowSums,
  prior: WindowSums,
  evidence?: Readonly<{
    current?: MetricPortalMetricEvidenceSet
    prior?: MetricPortalMetricEvidenceSet
  }>,
): PortalAnalyticsRepository {
  const base = createFakePortalMetrics()
  let sums = 0
  let evidenceReads = 0
  return {
    ...base,
    async getPortalKpiSums() {
      sums += 1
      return windowSums(sums === 1 ? current : prior)
    },
    async getPortalMetricEvidence() {
      evidenceReads += 1
      return (
        (evidenceReads === 1 ? evidence?.current : evidence?.prior) ?? readyEvidence()
      )
    },
  }
}

async function run30Days(portalMetrics: PortalAnalyticsRepository) {
  const now = new Date()
  return getPortalAnalytics({
    portalMetrics,
    portalLifetime: createUnusedPortalLifetime(),
    responseIntegrity: createFakeResponseIntegrity(),
  })({
    organizationId: ORG,
    propertyId: PROP,
    portalId: PORT,
    startDate: new Date(now.getTime() - 30 * 86_400_000),
    endDate: now,
    timeRange: '30d',
    propertyTimezone: 'UTC',
  })
}

describe('getPortalAnalytics: the average is held back below the floor', () => {
  it('shows no average at n = 4 and says why, keeping the true n', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 4, ratingTotal: 18 },
        { ratingCount: 4, ratingTotal: 18 },
      ),
    )

    expect(result.kpis.avgRating.value).toBeNull()
    expect(result.kpis.avgRating.priorValue).toBeNull()
    expect(result.kpis.avgRating.comparison).toBeNull()
    expect(result.kpis.avgRating.sampleCount).toBe(4)
    expect(result.kpis.avgRating.evidence).toMatchObject({
      state: 'insufficient_data',
      availabilityReason: 'below_minimum_sample',
      sampleCount: 4,
    })
    // The count itself is not withheld: four ratings is four ratings.
    expect(result.kpis.ratings.value).toBe(4)
    // A distribution or daily averages would reveal the withheld average.
    expect(result.ratingDistribution).toEqual([])
    expect(result.ratingTrend).toEqual([])
  })

  it('shows the average from n = 5', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 5, ratingTotal: 22 },
        { ratingCount: 5, ratingTotal: 20 },
      ),
    )

    expect(result.kpis.avgRating.value).toBe(4.4)
    expect(result.kpis.avgRating.priorValue).toBe(4)
    expect(result.kpis.avgRating.evidence).toMatchObject({
      state: 'ready',
      availabilityReason: null,
    })
    expect(result.ratingDistribution).toHaveLength(2)
    expect(result.ratingTrend).toHaveLength(2)
  })

  it('withholds only the side of the period that is too small', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 6, ratingTotal: 27 },
        { ratingCount: 3, ratingTotal: 12 },
      ),
    )

    expect(result.kpis.avgRating.value).toBe(4.5)
    expect(result.kpis.avgRating.priorValue).toBeNull()
    expect(result.kpis.avgRating.priorSampleCount).toBe(3)
    expect(result.kpis.avgRating.comparison).toBeNull()
  })

  it('keeps the comparison at its own floor of 10 ratings per period', async () => {
    const belowFloor = await run30Days(
      metricsForWindows(
        { ratingCount: 9, ratingTotal: 42 },
        { ratingCount: 12, ratingTotal: 48 },
      ),
    )
    expect(belowFloor.kpis.avgRating.value).toBe(4.7)
    expect(belowFloor.kpis.avgRating.priorValue).toBe(4)
    expect(belowFloor.kpis.avgRating.comparison).toBeNull()

    const atFloor = await run30Days(
      metricsForWindows(
        { ratingCount: 10, ratingTotal: 45 },
        { ratingCount: 10, ratingTotal: 40 },
      ),
    )
    expect(atFloor.kpis.avgRating.comparison).toBe(0.5)
  })
})

describe('getPortalAnalytics: Google opens and qualified scans', () => {
  it('returns absolute prior values for every count', async () => {
    const result = await run30Days(
      metricsForWindows(
        { scans: 60, ratingCount: 12, ratingTotal: 50, googleOpens: 9, feedback: 4 },
        { scans: 40, ratingCount: 6, ratingTotal: 25, googleOpens: 0, feedback: 2 },
      ),
    )

    expect(result.kpis.scans).toMatchObject({ value: 60, priorValue: 40, trend: 50 })
    expect(result.kpis.ratings).toMatchObject({ value: 12, priorValue: 6, trend: 100 })
    expect(result.kpis.feedback).toMatchObject({ value: 4, priorValue: 2, trend: 100 })
    // A zero prior is an absolute value, and a percentage over zero is not one.
    expect(result.kpis.googleOpens).toMatchObject({
      value: 9,
      priorValue: 0,
      trend: null,
    })
  })

  it('builds the funnel from qualified scans, ratings and Google opens', async () => {
    const result = await run30Days(
      metricsForWindows(
        { scans: 3, ratingCount: 7, ratingTotal: 30, googleOpens: 5 },
        {},
      ),
    )

    // More ratings than scans is real data for windows before qualified scans
    // began, and the use case reports it as it is. Presentation decides how.
    expect(result.engagementFunnel).toEqual({
      qualifiedScans: 3,
      ratings: 7,
      googleOpens: 5,
    })
  })

  it('reports unattributed destinations as insufficient, never as a smaller count', async () => {
    const result = await run30Days(
      metricsForWindows(
        { scans: 10, googleOpens: 2 },
        { scans: 10, googleOpens: 2 },
        {
          current: {
            ...readyEvidence(),
            reviewLinkClicks: {
              ...metricEvidence('click-version'),
              state: 'insufficient',
              verifiedThrough: null,
              availabilityReason: 'destination_unattributed',
            },
          },
        },
      ),
    )

    expect(result.kpis.googleOpens.value).toBeNull()
    expect(result.kpis.googleOpens.trend).toBeNull()
    expect(result.kpis.googleOpens.evidence).toMatchObject({
      state: 'insufficient_data',
      availabilityReason: 'destination_unattributed',
    })
    // The other counts are unaffected, and the funnel cannot include the step.
    expect(result.kpis.scans.value).toBe(10)
    expect(result.engagementFunnel).toBeNull()
  })

  it('withholds a prior Google-opens figure whose own window is unattributed', async () => {
    const result = await run30Days(
      metricsForWindows(
        { googleOpens: 4 },
        { googleOpens: 3 },
        {
          prior: {
            ...readyEvidence(),
            reviewLinkClicks: {
              ...metricEvidence('click-version'),
              state: 'insufficient',
              verifiedThrough: null,
              availabilityReason: 'destination_unattributed',
            },
          },
        },
      ),
    )

    expect(result.kpis.googleOpens.value).toBe(4)
    expect(result.kpis.googleOpens.priorValue).toBeNull()
    expect(result.kpis.googleOpens.trend).toBeNull()
  })
})

const QUALIFIED_SCANS_SINCE = (() => {
  const registered = findMetricVersionById(METRIC_VERSION_IDS.qualifiedScanGoal)
  if (!registered) throw new Error('qualified scan version is missing')
  return registered.version.effectiveFrom
})()

/** Runs one preset over a window of `days` days that opens at `startsAt`. */
async function runWindowStartingBeforeMeasure(
  timeRange: '60d' | '90d',
  days: number,
  startsAt: Date,
) {
  const endDate = new Date(startsAt.getTime() + days * 86_400_000)
  return getPortalAnalytics({
    portalMetrics: metricsForWindows(
      { scans: 40, ratingCount: 6, ratingTotal: 27 },
      {
        scans: 0,
        ratingCount: 6,
        ratingTotal: 24,
      },
    ),
    portalLifetime: createUnusedPortalLifetime(),
    responseIntegrity: createFakeResponseIntegrity(),
  })({
    organizationId: ORG,
    propertyId: PROP,
    portalId: PORT,
    startDate: startsAt,
    endDate,
    timeRange,
    propertyTimezone: 'UTC',
  })
}

describe('getPortalAnalytics: qualified scans have a first day', () => {
  const day = 86_400_000

  it('exposes the day qualified scans began counting, from the registry', async () => {
    const result = await run30Days(metricsForWindows({}, {}))
    expect(result.qualifiedScansSince).toEqual(QUALIFIED_SCANS_SINCE)
  })

  it('has no prior figure for a prior window that opens before the measure existed', async () => {
    // Current window starts exactly at the measure's first day, so its prior
    // window is wholly before it: a zero there would read as a verified zero.
    const result = await runWindowStartingBeforeMeasure('60d', 60, QUALIFIED_SCANS_SINCE)

    expect(result.kpis.scans).toMatchObject({
      value: 40,
      priorValue: null,
      trend: null,
      priorUnavailableReason: 'measure_not_yet_counted',
    })
    // The other measures existed for the prior window and keep their figure.
    expect(result.kpis.ratings.priorValue).toBe(6)
    expect(result.kpis.ratings.priorUnavailableReason ?? null).toBeNull()
  })

  it('has no prior figure when the prior window only partly follows the measure', async () => {
    const start = new Date(QUALIFIED_SCANS_SINCE.getTime() + 10 * day)
    const result = await runWindowStartingBeforeMeasure('60d', 60, start)

    expect(result.kpis.scans.priorValue).toBeNull()
    expect(result.kpis.scans.priorUnavailableReason).toBe('measure_not_yet_counted')
  })

  it('says a current window that opens before the measure only covers part of it', async () => {
    const start = new Date(QUALIFIED_SCANS_SINCE.getTime() - 20 * day)
    const result = await runWindowStartingBeforeMeasure('90d', 90, start)

    expect(result.kpis.scans.value).toBe(40)
    expect(result.kpis.scans.evidence).toMatchObject({
      state: 'ready',
      availabilityReason: 'measure_started_mid_period',
    })
    // No other measure carries the caveat.
    expect(result.kpis.ratings.evidence.availabilityReason).toBeNull()
  })

  it('keeps a window that starts on the measure first day complete', async () => {
    const result = await runWindowStartingBeforeMeasure('60d', 60, QUALIFIED_SCANS_SINCE)
    expect(result.kpis.scans.evidence.availabilityReason).toBeNull()
  })

  it('does not overwrite a stronger evidence reason with the mid-period note', async () => {
    const start = new Date(QUALIFIED_SCANS_SINCE.getTime() - 20 * day)
    const endDate = new Date(start.getTime() + 90 * day)
    const result = await getPortalAnalytics({
      portalMetrics: metricsForWindows(
        { scans: 40 },
        {},
        {
          current: {
            ...readyEvidence(),
            scans: {
              ...metricEvidence('scan-version'),
              state: 'updating',
              verifiedThrough: null,
              availabilityReason: 'consumer_receipt_pending',
            },
          },
        },
      ),
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
    })({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: start,
      endDate,
      timeRange: '90d',
      propertyTimezone: 'UTC',
    })

    expect(result.kpis.scans.evidence.availabilityReason).toBe('consumer_receipt_pending')
  })
})

describe('getPortalAnalytics: a missing comparison says why', () => {
  it('blames the sample only when both periods are ready and too small', async () => {
    const small = await run30Days(
      metricsForWindows(
        { ratingCount: 9, ratingTotal: 42 },
        { ratingCount: 12, ratingTotal: 48 },
      ),
    )
    expect(small.kpis.avgRating.comparison).toBeNull()
    expect(small.kpis.avgRating.comparisonWithheld).toBe('sample_too_small')
  })

  it('blames the pipeline when the prior window is not ready', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 12, ratingTotal: 54 },
        { ratingCount: 12, ratingTotal: 48 },
        {
          prior: {
            ...readyEvidence(),
            privateRatings: {
              ...metricEvidence('rating-version'),
              state: 'updating',
              verifiedThrough: null,
              availabilityReason: 'consumer_receipt_pending',
            },
          },
        },
      ),
    )
    expect(result.kpis.avgRating.comparison).toBeNull()
    expect(result.kpis.avgRating.comparisonWithheld).toBe('evidence_not_ready')
  })

  it('blames the pipeline when the current window is not ready', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 12, ratingTotal: 54 },
        { ratingCount: 12, ratingTotal: 48 },
        {
          current: {
            ...readyEvidence(),
            privateRatings: {
              ...metricEvidence('rating-version'),
              state: 'unavailable',
              verifiedThrough: null,
              availabilityReason: 'projection_missing',
            },
          },
        },
      ),
    )
    expect(result.kpis.avgRating.comparisonWithheld).toBe('evidence_not_ready')
  })

  it('has nothing to withhold when the comparison is shown', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 10, ratingTotal: 45 },
        { ratingCount: 10, ratingTotal: 40 },
      ),
    )
    expect(result.kpis.avgRating.comparison).toBe(0.5)
    expect(result.kpis.avgRating.comparisonWithheld).toBeNull()
  })
})

describe('getPortalAnalytics: All Time counts Google selections only', () => {
  type LifetimeValues = Record<
    keyof ReturnType<typeof emptyPortalLifetimeAggregate>['values'],
    number
  >
  function lifetimeWith(overrides: Partial<LifetimeValues>) {
    const aggregate = emptyPortalLifetimeAggregate()
    return { ...aggregate, values: { ...aggregate.values, ...overrides } }
  }

  async function runAllTime(aggregate: ReturnType<typeof lifetimeWith>) {
    return getPortalAnalytics({
      portalMetrics: createFakePortalMetrics(),
      portalLifetime: { get: vi.fn(async () => aggregate) },
      responseIntegrity: createFakeResponseIntegrity(),
    })({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(0),
      endDate: new Date(),
      timeRange: 'all',
      propertyTimezone: 'UTC',
    })
  }

  it('leaves secondary-link selections out of Google opens and the funnel', async () => {
    const result = await runAllTime(
      lifetimeWith({
        qualifiedScanCount: 30,
        privateRatingCount: 6,
        privateRatingSum: 27,
        googleReviewSelectionCount: 4,
        secondaryLinkSelectionCount: 9,
      }),
    )

    expect(result.kpis.googleOpens.value).toBe(4)
    expect(result.kpis.googleOpens.priorValue).toBeNull()
    expect(result.kpis.ratings.value).toBe(6)
    expect(result.engagementFunnel).toEqual({
      qualifiedScans: 30,
      ratings: 6,
      googleOpens: 4,
    })
  })

  it('holds the all-time average back below five ratings too', async () => {
    const result = await runAllTime(
      lifetimeWith({
        privateRatingCount: 4,
        privateRatingSum: 18,
        privateRating4Count: 2,
        privateRating5Count: 2,
      }),
    )

    expect(result.kpis.avgRating.value).toBeNull()
    expect(result.kpis.avgRating.sampleCount).toBe(4)
    expect(result.kpis.avgRating.evidence).toMatchObject({
      state: 'insufficient_data',
      availabilityReason: 'below_minimum_sample',
    })
    expect(result.ratingDistribution).toEqual([])
    expect(result.kpis.ratings.value).toBe(4)
  })
})
