import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ORG,
  PROP,
  PORT,
  createAuthorizedPortalAnalytics,
  metricEvidence,
  readyEvidence,
  createFakeResponseIntegrity,
  createFakePortalVersions,
  metricsForWindows,
  run30Days,
  FOUR_RATINGS_IN_TWO_WEEKS,
  QUALIFIED_SCANS_SINCE,
  runWindowStartingBeforeMeasure,
} from './portal-analytics.test-fixtures'

beforeEach(() => vi.setSystemTime(new Date('2026-10-15T12:00:00Z')))
afterEach(() => vi.useRealTimers())

describe('getPortalAnalytics: the average is held back below the floor', () => {
  it('shows no average at n = 4 and says why, keeping the true n', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 4, ratingTotal: 18 },
        { ratingCount: 4, ratingTotal: 18 },
        undefined,
        FOUR_RATINGS_IN_TWO_WEEKS,
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
    expect(result.series?.buckets.every((week) => week.average === null)).toBe(true)
  })

  it('still counts the ratings of each week when the window is below the floor', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 4, ratingTotal: 18 },
        { ratingCount: 4, ratingTotal: 18 },
        undefined,
        FOUR_RATINGS_IN_TWO_WEEKS,
      ),
    )

    // The strip says 4 private ratings, so the weekly column must say where.
    expect(result.series?.buckets.map((week) => week.ratings)).toEqual([3, 0, 0, 1, 0])
    expect(
      result.series?.buckets.map((week) => [week.average, week.averageWithheld]),
    ).toEqual([
      [null, 'below_floor'],
      [null, 'below_floor'],
      [null, 'below_floor'],
      [null, 'below_floor'],
      [null, 'below_floor'],
    ])
  })

  it('leaves the weekly counts unknown, not zero, while the ratings are not ready', async () => {
    const result = await run30Days(
      metricsForWindows(
        { ratingCount: 4, ratingTotal: 18 },
        { ratingCount: 4, ratingTotal: 18 },
        {
          current: {
            ...readyEvidence(),
            privateRatings: {
              ...metricEvidence('rating-version'),
              state: 'updating',
              verifiedThrough: null,
              availabilityReason: 'consumer_receipt_pending',
            },
          },
        },
        FOUR_RATINGS_IN_TWO_WEEKS,
      ),
    )

    expect(result.series?.buckets.every((week) => week.ratings === null)).toBe(true)
    expect(
      result.series?.buckets.every((week) => week.averageWithheld === 'not_ready'),
    ).toBe(true)
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
    expect(result.series?.buckets.some((week) => week.average !== null)).toBe(true)
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
    const result = await createAuthorizedPortalAnalytics({
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

      responseIntegrity: createFakeResponseIntegrity(),
      portalVersions: createFakePortalVersions(),
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
