import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getPortalAnalytics as authorizedGetPortalAnalytics,
  type GetPortalAnalyticsDeps,
} from './get-portal-analytics.server'
import { propertyId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { PortalAnalyticsData } from '../domain/dashboard-types'
import type { PortalAnalyticsRepository } from '../application/ports/portal-analytics.repository'
import {
  ORG,
  PROP,
  PORT,
  createAuthorizedPortalAnalytics,
  createFakePortalMetrics,
  metricEvidence,
  readyEvidence,
  createFakeResponseIntegrity,
  createFakePortalVersions,
  createUnusedPortalLifetime,
  emptyPortalLifetimeAggregate,
  SOFIA_START,
  SOFIA_END,
  resultsTabDeps,
  runResultsTab,
} from './portal-analytics.test-fixtures'

beforeEach(() => vi.setSystemTime(new Date('2026-10-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

describe('getPortalAnalytics (use case)', () => {
  it('composes portal KPI sums into PortalAnalyticsData', async () => {
    const metrics = createFakePortalMetrics()
    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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
    expect(result.series?.buckets.length).toBeGreaterThan(0)
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
    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: { get: vi.fn(async () => emptyPortalLifetimeAggregate()) },
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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

    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: dynamicMetrics,
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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
    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: { ...metrics, getPortalKpiSums },
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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
    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: metrics,
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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
    expect(result.series).toBeNull()

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
    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: { get: lifetimeGet },
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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
    expect(result.series).toBeNull()
  })

  it('derives one correction-aware engagement funnel from governed rows', async () => {
    const metrics = createFakePortalMetrics()
    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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
    const analytics = createAuthorizedPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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

describe('getPortalAnalytics authorization', () => {
  const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')
  const manager = buildTestAuthContext({ organizationId: ORG, role: 'PropertyManager' })
  const last30Days = () => {
    const endDate = new Date()
    return {
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(endDate.getTime() - 30 * 86_400_000),
      endDate,
      timeRange: '30d' as const,
      propertyTimezone: 'UTC',
    }
  }
  const readsFor = (propertyAccess: GetPortalAnalyticsDeps['propertyAccess']) => {
    const metrics = createFakePortalMetrics()
    const analytics = authorizedGetPortalAnalytics({
      portalMetrics: metrics,
      portalLifetime: createUnusedPortalLifetime(),
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
      propertyAccess,
    })
    return { metrics, analytics }
  }

  it('refuses a manager with no grant on the Property before anything is read', async () => {
    const { metrics, analytics } = readsFor(async () => [OTHER_PROPERTY])

    await expect(analytics(last30Days(), manager)).rejects.toMatchObject({
      _tag: 'DashboardError',
      code: 'forbidden',
    })
    expect(metrics.calls).toEqual([])
  })

  it('refuses the lifetime read the same way', async () => {
    const { metrics, analytics } = readsFor(async () => [OTHER_PROPERTY])

    await expect(
      analytics({ ...last30Days(), startDate: new Date(0), timeRange: 'all' }, manager),
    ).rejects.toMatchObject({ _tag: 'DashboardError', code: 'forbidden' })
    expect(metrics.calls).toEqual([])
  })

  it('serves a manager granted the Property', async () => {
    const { analytics } = readsFor(async () => [PROP])

    const result = await analytics(last30Days(), manager)

    expect(result.kpis.scans.value).toBe(100)
  })
})

it('reads link counts and current Portal labels for windows and All Time', async () => {
  const deps = resultsTabDeps()
  const listResultsLinks = vi.fn(async () => ({
    enabled: true,
    rows: [
      { linkId: 'a', label: 'Menu', iconKey: null },
      { linkId: 'b', label: 'Book', iconKey: null },
    ],
  }))
  const getPortalLinkTapCounts = vi.fn(async () => [
    { linkId: 'a', taps: 3 },
    { linkId: 'gone', taps: 2 },
  ])
  const readDeps = {
    ...deps,
    portalMetrics: { ...deps.portalMetrics, getPortalLinkTapCounts },
    portalVersions: { ...deps.portalVersions, listResultsLinks },
  }
  const result = await runResultsTab(readDeps)
  expect(result.linkTaps).toEqual({
    total: 5,
    countedSince: '2026-11-01',
    removedTaps: 2,
    rows: [
      { linkId: 'a', label: 'Menu', iconKey: null, taps: 3 },
      { linkId: 'b', label: 'Book', iconKey: null, taps: 0 },
    ],
  })
  expect(getPortalLinkTapCounts).toHaveBeenLastCalledWith({
    organizationId: ORG,
    propertyId: PROP,
    portalId: PORT,
    startAt: SOFIA_START,
    endAt: SOFIA_END,
  })
  const lifetime = await runResultsTab(readDeps, { timeRange: 'all' })
  expect(lifetime.linkTaps).toEqual(result.linkTaps)
  expect(lifetime.scanPatterns).toBeNull()
  expect(getPortalLinkTapCounts).toHaveBeenLastCalledWith({
    organizationId: ORG,
    propertyId: PROP,
    portalId: PORT,
    startAt: null,
    endAt: SOFIA_END,
  })
})

it('reduces Guest scan counts to a summary and never reads them for All Time', async () => {
  const deps = resultsTabDeps()
  const getPortalScanPatterns = vi.fn(async () => [
    { channel: 'qr' as const, hour: 12, weekday: 5, scans: 30 },
  ])
  const readDeps = {
    ...deps,
    responseIntegrity: { ...deps.responseIntegrity, getPortalScanPatterns },
  }
  expect((await runResultsTab(readDeps)).scanPatterns).toEqual({
    channels: { qr: 30, nfc: 0 },
    busiest: { slots: [{ startHour: 11, endHour: 13 }], weekday: 5 },
  })
  expect(getPortalScanPatterns).toHaveBeenCalledWith({
    organizationId: ORG,
    propertyId: PROP,
    portalId: PORT,
    startAt: SOFIA_START,
    endAt: SOFIA_END,
    timezone: 'Europe/Sofia',
  })
  await runResultsTab(readDeps, { timeRange: 'all' })
  expect(getPortalScanPatterns).toHaveBeenCalledTimes(1)
})
