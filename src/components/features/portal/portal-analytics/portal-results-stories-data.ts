// One Portal's Results as board 07 draws it: Pool & Terrace, last 30 days on
// 30 Sep, Europe/Sofia. Shared by the stories and the presentation tests so the
// figures they check are the figures the board prints.
import type {
  PortalAnalyticsData,
  PortalMetricEvidence,
  PortalSeriesBucket,
} from '#/contexts/reporting/application/public-api'

const RESULTS_COMPUTED_AT = new Date('2026-09-30T11:00:00.000Z')

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

export const RESULTS_WEEKS: readonly PortalSeriesBucket[] = WEEK_DATES.map(
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
  series: { bucketDays: 7, buckets: RESULTS_WEEKS },
  versionMarkers: [
    {
      version: 5,
      kind: 'publish',
      activatedAt: new Date('2026-09-22T06:00:00.000Z'),
      localDate: '2026-09-22',
      bucket: 3,
      dayInBucket: 0,
    },
  ],
  linkTaps: {
    total: 169,
    countedSince: '2026-11-01',
    removedTaps: 3,
    rows: [
      { linkId: 'menu', label: 'Menu', iconKey: null, taps: 96 },
      { linkId: 'book', label: 'Book a table', iconKey: null, taps: 50 },
      { linkId: 'website', label: 'Website', iconKey: null, taps: 20 },
      { linkId: 'instagram', label: 'Instagram', iconKey: null, taps: 0 },
    ],
  },
  scanPatterns: {
    channels: { qr: 380, nfc: 32 },
    busiest: {
      slots: [
        { startHour: 12, endHour: 14 },
        { startHour: 19, endHour: 21 },
      ],
      weekday: 5,
    },
  },
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
  thresholds: { averageMinSample: 5, comparisonMinSample: 10, busiestMinScans: 30 },
  responseIntegrity: {
    accepted: 118,
    filteredAutomatically: 0,
    underReview: 0,
    total: 118,
  },
}
