import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
  emptyPortalLifetimeAggregate,
  SOFIA_START,
  SOFIA_END,
  SOFIA_PRIOR_START,
  SOFIA_PRIOR_END,
  resultsTabDeps,
  runResultsTab,
} from './portal-analytics.test-fixtures'

beforeEach(() => vi.setSystemTime(new Date('2026-10-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

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
    return createAuthorizedPortalAnalytics({
      portalMetrics: createFakePortalMetrics(),
      portalLifetime: { get: vi.fn(async () => aggregate) },
      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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

describe('getPortalAnalytics: the Results tab', () => {
  it('cuts the window into buckets from its own first local day', async () => {
    const metrics = createFakePortalMetrics()
    const getPortalWeeklyReadings = vi.fn(metrics.getPortalWeeklyReadings)
    const result = await runResultsTab(
      resultsTabDeps({ metrics: { ...metrics, getPortalWeeklyReadings } }),
    )

    expect(getPortalWeeklyReadings).toHaveBeenNthCalledWith(
      1,
      ORG,
      PROP,
      PORT,
      SOFIA_START,
      SOFIA_END,
      '2026-09-01',
      7,
    )
    expect(
      result.series?.buckets.map((week) => [week.startLocalDate, week.endLocalDate]),
    ).toEqual([
      ['2026-09-01', '2026-09-07'],
      ['2026-09-08', '2026-09-14'],
      ['2026-09-15', '2026-09-21'],
      ['2026-09-22', '2026-09-28'],
      ['2026-09-29', '2026-09-30'],
    ])
    expect(result.series?.buckets[0]).toMatchObject({ scans: 60, priorScans: 60 })
    expect(result.series?.buckets[1]).toMatchObject({
      scans: 40,
      ratings: 5,
      average: 4.4,
    })
  })

  it('reads the prior window from its own first local day and hands both periods back', async () => {
    const metrics = createFakePortalMetrics()
    const getPortalWeeklyReadings = vi.fn(metrics.getPortalWeeklyReadings)
    const result = await runResultsTab(
      resultsTabDeps({ metrics: { ...metrics, getPortalWeeklyReadings } }),
    )

    expect(getPortalWeeklyReadings).toHaveBeenNthCalledWith(
      2,
      ORG,
      PROP,
      PORT,
      SOFIA_PRIOR_START,
      SOFIA_PRIOR_END,
      '2026-08-02',
      7,
    )
    expect(result.comparePeriod).toEqual({
      startAt: SOFIA_PRIOR_START,
      endAt: SOFIA_PRIOR_END,
    })
  })

  it('names the window and its comparison as local days for labels', async () => {
    const result = await runResultsTab(resultsTabDeps())

    expect(result.localDays).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
      compareStart: '2026-08-02',
      compareEnd: '2026-08-31',
    })
  })

  it('reads nothing from the prior window when the comparison is off', async () => {
    const metrics = createFakePortalMetrics()
    const getPortalKpiSums = vi.fn(metrics.getPortalKpiSums)
    const getPortalWeeklyReadings = vi.fn(metrics.getPortalWeeklyReadings)
    const getPortalMetricEvidence = vi.fn(metrics.getPortalMetricEvidence)

    const result = await runResultsTab(
      resultsTabDeps({
        metrics: {
          ...metrics,
          getPortalKpiSums,
          getPortalWeeklyReadings,
          getPortalMetricEvidence,
        },
      }),
      { compare: false },
    )

    expect(getPortalKpiSums).toHaveBeenCalledTimes(1)
    expect(getPortalWeeklyReadings).toHaveBeenCalledTimes(1)
    expect(getPortalMetricEvidence).toHaveBeenCalledTimes(1)
    expect(result.comparePeriod).toBeNull()
    expect(result.localDays).toMatchObject({
      start: '2026-09-01',
      compareStart: null,
      compareEnd: null,
    })
    expect(result.kpis.scans.priorValue).toBeNull()
    expect(result.kpis.scans.trend).toBeNull()
    expect(result.series?.buckets.every((week) => week.priorScans === null)).toBe(true)
  })

  it('compares by default', async () => {
    const result = await runResultsTab(resultsTabDeps())

    expect(result.comparePeriod).not.toBeNull()
    expect(result.kpis.scans.priorValue).toBe(100)
  })

  it('marks each version that went live in the window, on its local day', async () => {
    const versions = createFakePortalVersions([
      { version: 5, kind: 'publish', activatedAt: new Date('2026-09-22T06:00:00.000Z') },
    ])

    const result = await runResultsTab(resultsTabDeps({ versions }))

    expect(versions.listPublicationActivationsBetween).toHaveBeenCalledWith(
      ORG,
      PROP,
      PORT,
      { startAt: SOFIA_START, endAt: SOFIA_END },
    )
    expect(result.versionMarkers).toEqual([
      expect.objectContaining({
        version: 5,
        kind: 'publish',
        localDate: '2026-09-22',
        bucket: 3,
        dayInBucket: 0,
      }),
    ])
  })

  it('counts private ratings by page language over the same window', async () => {
    const integrity = createFakeResponseIntegrity()

    const result = await runResultsTab(resultsTabDeps({ integrity }))

    expect(integrity.getPortalRatingLanguages).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startAt: SOFIA_START,
      endAt: SOFIA_END,
    })
    expect(result.ratingLanguages).toEqual({
      total: 8,
      languages: [
        { locale: 'en', count: 5 },
        { locale: 'bg', count: 2 },
      ],
      unrecorded: 1,
    })
  })

  it('tells the client the sample floors so it keeps no copy of them', async () => {
    const result = await runResultsTab(resultsTabDeps())

    expect(result.thresholds).toEqual({
      averageMinSample: 5,
      comparisonMinSample: 10,
      busiestMinScans: 30,
    })
  })

  it('holds every weekly average back while the ratings are not ready', async () => {
    const metrics = createFakePortalMetrics({
      evidence: {
        ...readyEvidence(),
        privateRatings: {
          ...metricEvidence('rating-version'),
          state: 'updating',
          verifiedThrough: null,
          availabilityReason: 'consumer_receipt_pending',
        },
      },
    })

    const result = await runResultsTab(resultsTabDeps({ metrics }))

    expect(result.series?.buckets.every((week) => week.average === null)).toBe(true)
    expect(result.series?.buckets[0]?.scans).toBe(60)
  })

  it('draws no prior scans for a window that opens before the measure was counted', async () => {
    const before = new Date('2026-07-15T21:00:00.000Z')
    const result = await runResultsTab(resultsTabDeps(), {
      startDate: before,
      endDate: new Date('2026-08-14T11:00:00.000Z'),
    })

    expect(result.kpis.scans.priorUnavailableReason).toBe('measure_not_yet_counted')
    expect(result.series?.buckets.every((week) => week.priorScans === null)).toBe(true)
  })

  it('serves All Time without a series, a comparison or markers, still by language', async () => {
    const deps = resultsTabDeps()
    const result = await createAuthorizedPortalAnalytics({
      ...deps,
      portalLifetime: { get: vi.fn(async () => emptyPortalLifetimeAggregate()) },
    })({
      organizationId: ORG,
      propertyId: PROP,
      portalId: PORT,
      startDate: new Date(0),
      endDate: SOFIA_END,
      timeRange: 'all',
      propertyTimezone: 'Europe/Sofia',
    })

    expect(result.series).toBeNull()
    expect(result.comparePeriod).toBeNull()
    expect(result.localDays).toBeNull()
    expect(result.versionMarkers).toEqual([])
    expect(result.ratingLanguages.total).toBe(8)
    expect(deps.portalVersions.listPublicationActivationsBetween).not.toHaveBeenCalled()
  })
})
