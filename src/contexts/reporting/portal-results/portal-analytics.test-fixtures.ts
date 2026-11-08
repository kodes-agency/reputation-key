import { vi } from 'vitest'
import {
  getPortalAnalytics as authorizedGetPortalAnalytics,
  type GetPortalAnalyticsDeps,
} from './get-portal-analytics.server'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { asAccountAdmin } from '#/shared/testing/authorized-reads'
import { METRIC_VERSION_IDS, findMetricVersionById } from '../readings/contracts'
import type { SeriesReadingRow } from '../domain/portal-results-series'
import type {
  MetricPortalMetricEvidenceSet,
  PortalAnalyticsRepository,
  PortalMetricSumRow,
  PortalRatingBucket,
} from '../application/ports/portal-analytics.repository'

export const ORG = organizationId('org-test')

export const PROP = propertyId('a0000000-0000-0000-0000-000000000001')

export const PORT = portalId('b0000000-0000-0000-0000-000000000001')

export const createAuthorizedPortalAnalytics = (
  deps: Omit<GetPortalAnalyticsDeps, 'propertyAccess'>,
) =>
  asAccountAdmin(
    authorizedGetPortalAnalytics({ ...deps, propertyAccess: async () => null }),
  )

export function createFakePortalMetrics(overrides?: {
  kpiSums?: readonly PortalMetricSumRow[]
  ratingDistribution?: readonly PortalRatingBucket[]
  weeklyReadings?: readonly SeriesReadingRow[]
  evidence?: MetricPortalMetricEvidenceSet
}): PortalAnalyticsRepository & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async getPortalTotals(...args) {
      return {
        sums: await this.getPortalKpiSums(...args),
        evidence: await this.getPortalMetricEvidence(...args),
        ratingDistribution: await this.getPortalRatingDistribution(...args),
      }
    },
    getPortalLinkTapCounts: async () => [],
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
    async getPortalWeeklyReadings() {
      calls.push('getPortalWeeklyReadings')
      return (
        overrides?.weeklyReadings ?? [
          { bucket: 0, metricKey: 'portal.qualified_scan', total: 60, count: 6 },
          { bucket: 1, metricKey: 'portal.qualified_scan', total: 40, count: 4 },
          { bucket: 1, metricKey: 'portal.rating', total: 22, count: 5 },
        ]
      )
    },
    async getPortalMetricEvidence() {
      calls.push('getPortalMetricEvidence')
      return overrides?.evidence ?? readyEvidence()
    },
  }
}

export function metricEvidence(definitionVersionId: string) {
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

export function readyEvidence() {
  return {
    scans: metricEvidence('scan-version'),
    privateRatings: metricEvidence('rating-version'),
    privateFeedback: metricEvidence('feedback-version'),
    reviewLinkClicks: metricEvidence('click-version'),
  }
}

export function createFakeResponseIntegrity() {
  return {
    getPortalResponseIntegritySummary: vi.fn(async () => ({
      accepted: 8,
      filteredAutomatically: 1,
      underReview: 1,
      total: 10,
    })),
    getPortalScanPatterns: vi.fn(async () => []),
    getPortalRatingLanguages: vi.fn(async () => ({
      total: 8,
      languages: [
        { locale: 'en', count: 5 },
        { locale: 'bg', count: 2 },
      ],
      unrecorded: 1,
    })),
  }
}

export function createFakePortalVersions(
  activations: readonly Readonly<{
    version: number
    kind: 'publish' | 'rollback'
    activatedAt: Date
  }>[] = [],
) {
  return {
    listResultsLinks: vi.fn(async () => ({ enabled: true, rows: [] })),
    listPublicationActivationsBetween: vi.fn(async () => activations),
  }
}

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

export function metricsForWindows(
  current: WindowSums,
  prior: WindowSums,
  evidence?: Readonly<{
    current?: MetricPortalMetricEvidenceSet
    prior?: MetricPortalMetricEvidenceSet
  }>,
  weeklyReadings?: readonly SeriesReadingRow[],
): PortalAnalyticsRepository {
  const base = createFakePortalMetrics({ weeklyReadings })
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

export async function run30Days(portalMetrics: PortalAnalyticsRepository) {
  const now = new Date('2026-10-01T12:00:00Z')
  return createAuthorizedPortalAnalytics({
    portalMetrics,

    responseIntegrity: createFakeResponseIntegrity(),
    portalVersions: createFakePortalVersions(),
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

export const FOUR_RATINGS_IN_TWO_WEEKS: readonly SeriesReadingRow[] = [
  { bucket: 0, metricKey: 'portal.rating', total: 13, count: 3 },
  { bucket: 3, metricKey: 'portal.rating', total: 5, count: 1 },
]

export const QUALIFIED_SCANS_SINCE = (() => {
  const registered = findMetricVersionById(METRIC_VERSION_IDS.qualifiedScanGoal)
  if (!registered) throw new Error('qualified scan version is missing')
  return registered.version.effectiveFrom
})()

export async function runWindowStartingBeforeMeasure(
  timeRange: '60d' | '90d',
  days: number,
  startsAt: Date,
) {
  const endDate = new Date(startsAt.getTime() + days * 86_400_000)
  return createAuthorizedPortalAnalytics({
    portalMetrics: metricsForWindows(
      { scans: 40, ratingCount: 6, ratingTotal: 27 },
      {
        scans: 0,
        ratingCount: 6,
        ratingTotal: 24,
      },
    ),

    responseIntegrity: createFakeResponseIntegrity(),
    portalVersions: createFakePortalVersions(),
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

export const SOFIA_START = new Date('2026-08-31T21:00:00.000Z')

export const SOFIA_END = new Date('2026-09-30T11:23:00.000Z')

export const SOFIA_PRIOR_START = new Date('2026-08-01T21:00:00.000Z')

export const SOFIA_PRIOR_END = new Date('2026-08-31T11:23:00.000Z')

export function resultsTabDeps(
  overrides?: Readonly<{
    metrics?: PortalAnalyticsRepository
    versions?: ReturnType<typeof createFakePortalVersions>
    integrity?: ReturnType<typeof createFakeResponseIntegrity>
  }>,
) {
  return {
    portalMetrics: overrides?.metrics ?? createFakePortalMetrics(),

    responseIntegrity: overrides?.integrity ?? createFakeResponseIntegrity(),
    portalVersions: overrides?.versions ?? createFakePortalVersions(),
  }
}

export function runResultsTab(
  deps: Omit<GetPortalAnalyticsDeps, 'propertyAccess'>,
  input?: Partial<Parameters<ReturnType<typeof createAuthorizedPortalAnalytics>>[0]>,
) {
  return createAuthorizedPortalAnalytics(deps)({
    organizationId: ORG,
    propertyId: PROP,
    portalId: PORT,
    startDate: SOFIA_START,
    endDate: SOFIA_END,
    timeRange: '30d',
    propertyTimezone: 'Europe/Sofia',
    ...input,
  })
}
