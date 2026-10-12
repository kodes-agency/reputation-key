// One Portal's Results as board 07 draws it: Pool & Terrace, last 30 days on
// 30 Sep, Europe/Sofia. Shared by the stories and the presentation tests so the
// figures they check are the figures the board prints.
import type {
  PortalAnalyticsData,
  PortalMetricEvidence,
  PortalSeriesWeek,
} from '#/contexts/reporting/application/public-api'

export const RESULTS_COMPUTED_AT = new Date('2026-09-30T11:00:00.000Z')

export function resultsEvidence(
  overrides: Partial<PortalMetricEvidence> = {},
): PortalMetricEvidence {
  return {
    definitionVersionId: 'story-version',
    state: 'ready',
    verifiedThrough: RESULTS_COMPUTED_AT,
    latestActivity: RESULTS_COMPUTED_AT,
    computedAt: RESULTS_COMPUTED_AT,
    completeness: 1,
    availabilityReason: null,
    correctionHead: null,
    sampleCount: 0,
    ...overrides,
  }
}

export function resultsCount(value: number, priorValue: number | null) {
  return {
    value,
    priorValue,
    trend: priorValue === null || priorValue === 0 ? null : value - priorValue,
    evidence: resultsEvidence({ sampleCount: value }),
  }
}

const SCANS = [108, 100, 88, 91, 25] as const
const PRIOR_SCANS = [86, 92, 89, 86, 28] as const
const RATINGS = [27, 30, 28, 29, 4] as const
const AVERAGES = [4.4, 4.4, 4.3, 4.4, null] as const
const WEEK_DATES = [
  ['2026-09-01', '2026-09-07', 7],
  ['2026-09-08', '2026-09-14', 7],
  ['2026-09-15', '2026-09-21', 7],
  ['2026-09-22', '2026-09-28', 7],
  ['2026-09-29', '2026-09-30', 2],
] as const

export const RESULTS_WEEKS: readonly PortalSeriesWeek[] = WEEK_DATES.map(
  ([startLocalDate, endLocalDate, days], index) => ({
    index,
    startLocalDate,
    endLocalDate,
    days,
    scans: SCANS[index] ?? 0,
    priorScans: PRIOR_SCANS[index] ?? 0,
    ratings: RATINGS[index] ?? 0,
    average: AVERAGES[index] ?? null,
    averageWithheld: AVERAGES[index] === null ? 'below_floor' : null,
  }),
)

const MS_PER_DAY = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * A long window cut into whole weeks that end on 30 Sep (13 of them is 90 days):
 * every third week has too few ratings for an average, the way a small business
 * sees it.
 */
export function resultsWeeksOf(count: number): readonly PortalSeriesWeek[] {
  const end = Date.UTC(2026, 8, 30)
  return Array.from({ length: count }, (_, index) => {
    const last = end - (count - 1 - index) * 7 * MS_PER_DAY
    const isSmall = index % 3 === 2
    return {
      index,
      startLocalDate: isoDay(last - 6 * MS_PER_DAY),
      endLocalDate: isoDay(last),
      days: 7,
      scans: 40 + ((index * 17) % 30),
      priorScans: 38 + ((index * 11) % 30),
      ratings: isSmall ? 3 : 12,
      average: isSmall ? null : 4.2,
      averageWithheld: isSmall ? ('below_floor' as const) : null,
    }
  })
}

export const RESULTS_HEALTHY: PortalAnalyticsData = {
  period: {
    startAt: new Date('2026-08-31T21:00:00.000Z'),
    endAt: RESULTS_COMPUTED_AT,
    timezone: 'Europe/Sofia',
  },
  comparePeriod: {
    startAt: new Date('2026-08-01T21:00:00.000Z'),
    endAt: new Date('2026-08-31T21:00:00.000Z'),
  },
  localDays: {
    start: '2026-09-01',
    end: '2026-09-30',
    compareStart: '2026-08-02',
    compareEnd: '2026-08-31',
  },
  qualifiedScansSince: new Date('2026-08-01T00:00:00.000Z'),
  lifetimeReconciliation: null,
  kpis: {
    scans: resultsCount(412, 381),
    ratings: resultsCount(118, 103),
    avgRating: {
      value: 4.4,
      priorValue: 4.3,
      comparison: 0.1,
      comparisonWithheld: null,
      sampleCount: 118,
      priorSampleCount: 103,
      evidence: resultsEvidence({ sampleCount: 118 }),
    },
    feedback: resultsCount(9, 7),
    googleOpens: resultsCount(64, 60),
  },
  engagementFunnel: { qualifiedScans: 412, ratings: 118, googleOpens: 64 },
  ratingDistribution: [
    { stars: 1, count: 4 },
    { stars: 2, count: 5 },
    { stars: 3, count: 9 },
    { stars: 4, count: 22 },
    { stars: 5, count: 78 },
  ],
  series: { weeks: RESULTS_WEEKS },
  versionMarkers: [
    {
      version: 5,
      kind: 'publish',
      activatedAt: new Date('2026-09-22T06:00:00.000Z'),
      localDate: '2026-09-22',
      week: 3,
      dayInWeek: 0,
    },
  ],
  ratingLanguages: {
    total: 118,
    languages: [
      { locale: 'en', count: 68 },
      { locale: 'bg', count: 28 },
      { locale: 'es', count: 13 },
      { locale: 'de', count: 9 },
    ],
    unrecorded: 0,
  },
  thresholds: { averageMinSample: 5, comparisonMinSample: 10 },
  responseIntegrity: {
    accepted: 118,
    filteredAutomatically: 0,
    underReview: 0,
    total: 118,
  },
}
