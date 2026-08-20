import {
  GOOGLE_PERFORMANCE_CATALOG_VERSION,
  type GoogleDailyMetric,
  type GooglePerformanceSourceReport,
} from './google-provider-contract'
import type {
  PerformanceAvailability,
  PerformanceMetricValue,
  PerformanceSeries,
  PropertyGooglePerformanceReportV1,
  PropertyPerformancePreset,
} from '#/shared/google-performance-report-contract'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'

const PRESET_DAYS: Readonly<Record<PropertyPerformancePreset, number>> = Object.freeze({
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
})

const IMPRESSION_DESKTOP_MAPS = 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS'
const IMPRESSION_DESKTOP_SEARCH = 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'
const IMPRESSION_MOBILE_MAPS = 'BUSINESS_IMPRESSIONS_MOBILE_MAPS'
const IMPRESSION_MOBILE_SEARCH = 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH'
const WEBSITE_CLICKS = 'WEBSITE_CLICKS'
const CALL_CLICKS = 'CALL_CLICKS'
const DIRECTION_REQUESTS = 'BUSINESS_DIRECTION_REQUESTS'
const CONVERSATIONS = 'BUSINESS_CONVERSATIONS'
const BOOKINGS = 'BUSINESS_BOOKINGS'
const MENU_CLICKS = 'BUSINESS_FOOD_MENU_CLICKS'

const SEARCH_METRICS: readonly GoogleDailyMetric[] = Object.freeze([
  IMPRESSION_DESKTOP_SEARCH,
  IMPRESSION_MOBILE_SEARCH,
])
const MAPS_METRICS: readonly GoogleDailyMetric[] = Object.freeze([
  IMPRESSION_DESKTOP_MAPS,
  IMPRESSION_MOBILE_MAPS,
])
const CORE_IMPRESSION_METRICS: readonly GoogleDailyMetric[] = Object.freeze([
  IMPRESSION_DESKTOP_MAPS,
  IMPRESSION_DESKTOP_SEARCH,
  IMPRESSION_MOBILE_MAPS,
  IMPRESSION_MOBILE_SEARCH,
])

type PropertyPerformancePeriod = PropertyGooglePerformanceReportV1['period']
type MetricPoints = ReadonlyMap<string, number>
type MetricPointIndex = ReadonlyMap<GoogleDailyMetric, MetricPoints>

type DerivedMetric = Readonly<{
  metric: PerformanceMetricValue
  current: ReadonlyMap<string, number>
}>

export class GooglePerformanceReportError extends Error {
  readonly code = 'stale_source' as const

  constructor() {
    super('Google Performance source range no longer matches the requested period')
    this.name = 'GooglePerformanceReportError'
  }
}

function localDateAt(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day! + days))
  return date.toISOString().slice(0, 10)
}

function localDateDistance(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) /
      86_400_000,
  )
}

function listLocalDates(start: string, count: number): readonly string[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) => addLocalDays(start, index)),
  )
}

export function buildPropertyPerformancePeriod(
  input: Readonly<{
    preset: PropertyPerformancePreset
    timezone: string
    now: Date
  }>,
): PropertyPerformancePeriod {
  const dayCount = PRESET_DAYS[input.preset]
  const localToday = localDateAt(input.now, input.timezone)
  const currentEndLocalDate = addLocalDays(localToday, -1)
  const currentStartLocalDate = addLocalDays(currentEndLocalDate, -(dayCount - 1))
  const priorEndLocalDate = addLocalDays(currentStartLocalDate, -1)
  const priorStartLocalDate = addLocalDays(priorEndLocalDate, -(dayCount - 1))
  return Object.freeze({
    preset: input.preset,
    timezone: input.timezone,
    currentStartLocalDate,
    currentEndLocalDate,
    priorStartLocalDate,
    priorEndLocalDate,
  })
}

function indexSource(source: GooglePerformanceSourceReport): MetricPointIndex {
  return new Map(
    source.series.map((series) => [
      series.metric,
      new Map(series.points.map((point) => [point.localDate, point.value])),
    ]),
  )
}

function availability(
  completeDayCount: number,
  requestedDayCount: number,
  hasAnyConstituent: boolean,
): PerformanceAvailability {
  if (completeDayCount === requestedDayCount) return 'ready'
  if (completeDayCount > 0) return 'partial'
  return hasAnyConstituent ? 'no_complete_days' : 'not_applicable_or_not_returned'
}

function sumMap(points: ReadonlyMap<string, number>): number | null {
  if (points.size === 0) return null
  let total = 0
  for (const value of points.values()) total += value
  return total
}

function deltaPercent(
  current: number | null,
  prior: number | null,
  currentDays: number,
  priorDays: number,
  requestedDays: number,
): number | null {
  if (
    current === null ||
    prior === null ||
    prior === 0 ||
    currentDays !== requestedDays ||
    priorDays !== requestedDays
  ) {
    return null
  }
  return ((current - prior) / prior) * 100
}

function pointsForMetric(
  index: MetricPointIndex,
  metric: GoogleDailyMetric,
  dates: readonly string[],
): ReadonlyMap<string, number> {
  const source = index.get(metric)
  if (!source) return new Map()
  const points = new Map<string, number>()
  for (const date of dates) {
    const value = source.get(date)
    if (value !== undefined) points.set(date, value)
  }
  return points
}

function pointsForDerivedMetric(
  index: MetricPointIndex,
  metrics: readonly GoogleDailyMetric[],
  dates: readonly string[],
): ReadonlyMap<string, number> {
  const sources = metrics.map((metric) => index.get(metric))
  if (sources.some((source) => !source)) return new Map()
  const points = new Map<string, number>()
  for (const date of dates) {
    let total = 0
    let complete = true
    for (const source of sources) {
      const value = source!.get(date)
      if (value === undefined) {
        complete = false
        break
      }
      total += value
    }
    if (complete) points.set(date, total)
  }
  return points
}

function metricValue(
  input: Readonly<{
    label: string
    current: ReadonlyMap<string, number>
    prior: ReadonlyMap<string, number>
    requestedDays: number
    hasAnyConstituent: boolean
  }>,
): PerformanceMetricValue {
  const value = sumMap(input.current)
  const priorValue = sumMap(input.prior)
  return Object.freeze({
    label: input.label,
    value,
    priorValue,
    deltaPercent: deltaPercent(
      value,
      priorValue,
      input.current.size,
      input.prior.size,
      input.requestedDays,
    ),
    availability: availability(
      input.current.size,
      input.requestedDays,
      input.hasAnyConstituent,
    ),
    completeDayCount: input.current.size,
    priorCompleteDayCount: input.prior.size,
  })
}

function rawMetric(
  index: MetricPointIndex,
  metric: GoogleDailyMetric,
  label: string,
  currentDates: readonly string[],
  priorDates: readonly string[],
): DerivedMetric {
  const current = pointsForMetric(index, metric, currentDates)
  const prior = pointsForMetric(index, metric, priorDates)
  return {
    current,
    metric: metricValue({
      label,
      current,
      prior,
      requestedDays: currentDates.length,
      hasAnyConstituent: index.has(metric),
    }),
  }
}

function derivedMetric(
  index: MetricPointIndex,
  metrics: readonly GoogleDailyMetric[],
  label: string,
  currentDates: readonly string[],
  priorDates: readonly string[],
): DerivedMetric {
  const current = pointsForDerivedMetric(index, metrics, currentDates)
  const prior = pointsForDerivedMetric(index, metrics, priorDates)
  return {
    current,
    metric: metricValue({
      label,
      current,
      prior,
      requestedDays: currentDates.length,
      hasAnyConstituent: metrics.some((metric) => index.has(metric)),
    }),
  }
}

function series(
  id: string,
  label: string,
  dates: readonly string[],
  values: ReadonlyMap<string, number>,
): PerformanceSeries {
  return Object.freeze({
    id,
    label,
    points: Object.freeze(
      dates.map((localDate) => {
        const value = values.get(localDate)
        return Object.freeze(
          value === undefined
            ? { localDate, value: null, availability: 'unavailable' as const }
            : { localDate, value, availability: 'returned' as const },
        )
      }),
    ),
  })
}

function latestDate(dates: Iterable<string>): string | null {
  let latest: string | null = null
  for (const date of dates) {
    if (latest === null || date > latest) latest = date
  }
  return latest
}

function sameCoverage(
  index: MetricPointIndex,
  metrics: readonly GoogleDailyMetric[],
  dates: readonly string[],
): boolean {
  const expected = metrics[0] ? pointsForMetric(index, metrics[0], dates) : new Map()
  for (const metric of metrics.slice(1)) {
    const candidate = pointsForMetric(index, metric, dates)
    if (candidate.size !== expected.size) return false
    for (const date of expected.keys()) {
      if (!candidate.has(date)) return false
    }
  }
  return metrics.every((metric) => index.has(metric))
}

function sourceHealth(
  index: MetricPointIndex,
  currentDates: readonly string[],
  completeCore: ReadonlyMap<string, number>,
): PropertyGooglePerformanceReportV1['sourceHealth'] {
  const requestedDates = new Set(currentDates)
  const returnedDates = new Set<string>()
  for (const points of index.values()) {
    for (const date of points.keys()) {
      if (requestedDates.has(date)) returnedDates.add(date)
    }
  }
  const latestReturnedDataLocalDate = latestDate(returnedDates)
  const latestCompleteCoreLocalDate = latestDate(completeCore.keys())
  const currentEnd = currentDates.at(-1)!
  if (latestReturnedDataLocalDate === null) {
    return Object.freeze({
      state: 'no_data',
      providerCheckedThroughLocalDate: currentEnd,
      latestReturnedDataLocalDate: null,
      latestCompleteCoreLocalDate: null,
      dataLagDays: null,
    })
  }
  if (latestCompleteCoreLocalDate === null) {
    return Object.freeze({
      state: 'partial',
      providerCheckedThroughLocalDate: currentEnd,
      latestReturnedDataLocalDate,
      latestCompleteCoreLocalDate: null,
      dataLagDays: null,
    })
  }
  const completeDates = [...completeCore.keys()].sort()
  const contiguousPrefix = completeDates.every(
    (date, index) => date === currentDates[index],
  )
  const consistentCoverage = sameCoverage(index, CORE_IMPRESSION_METRICS, currentDates)
  const dataLagDays = localDateDistance(latestCompleteCoreLocalDate, currentEnd)
  const state =
    !consistentCoverage || !contiguousPrefix
      ? 'partial'
      : dataLagDays <= 3
        ? 'ready'
        : dataLagDays <= 7
          ? 'delayed'
          : 'stale'
  return Object.freeze({
    state,
    providerCheckedThroughLocalDate: currentEnd,
    latestReturnedDataLocalDate,
    latestCompleteCoreLocalDate,
    dataLagDays,
  })
}

export function composePropertyGooglePerformanceReport(
  input: Readonly<{
    source: GooglePerformanceSourceReport
    preset: PropertyPerformancePreset
    timezone: string
    retrievedAt: Date
    contentExpiresAt: Date
    authorizationLease: ProviderContentLeaseDto
  }>,
): PropertyGooglePerformanceReportV1 {
  const period = buildPropertyPerformancePeriod({
    preset: input.preset,
    timezone: input.timezone,
    now: input.retrievedAt,
  })
  if (
    input.source.requestedRange.startLocalDate !== period.priorStartLocalDate ||
    input.source.requestedRange.endLocalDate !== period.currentEndLocalDate
  ) {
    throw new GooglePerformanceReportError()
  }
  const dayCount = PRESET_DAYS[input.preset]
  const currentDates = listLocalDates(period.currentStartLocalDate, dayCount)
  const priorDates = listLocalDates(period.priorStartLocalDate, dayCount)
  const index = indexSource(input.source)

  const totalImpressions = derivedMetric(
    index,
    CORE_IMPRESSION_METRICS,
    'Total profile impressions',
    currentDates,
    priorDates,
  )
  const search = derivedMetric(
    index,
    SEARCH_METRICS,
    'Search impressions',
    currentDates,
    priorDates,
  )
  const maps = derivedMetric(
    index,
    MAPS_METRICS,
    'Maps impressions',
    currentDates,
    priorDates,
  )
  const website = rawMetric(
    index,
    WEBSITE_CLICKS,
    'Website clicks',
    currentDates,
    priorDates,
  )
  const calls = rawMetric(index, CALL_CLICKS, 'Call clicks', currentDates, priorDates)
  const directions = rawMetric(
    index,
    DIRECTION_REQUESTS,
    'Direction requests',
    currentDates,
    priorDates,
  )
  const additional = (
    [
      {
        metric: CONVERSATIONS,
        value: rawMetric(index, CONVERSATIONS, 'Conversations', currentDates, priorDates),
      },
      {
        metric: BOOKINGS,
        value: rawMetric(index, BOOKINGS, 'Bookings', currentDates, priorDates),
      },
      {
        metric: MENU_CLICKS,
        value: rawMetric(index, MENU_CLICKS, 'Menu clicks', currentDates, priorDates),
      },
    ] as const
  ).flatMap(({ metric, value }) => (index.has(metric) ? [value.metric] : []))

  const ttlSeconds = Math.max(
    1,
    Math.ceil((input.contentExpiresAt.getTime() - input.retrievedAt.getTime()) / 1_000),
  )
  return Object.freeze({
    contractVersion: 1,
    catalogVersion: GOOGLE_PERFORMANCE_CATALOG_VERSION,
    sourceLabel: 'Google Business Profile',
    retrievedAt: input.retrievedAt.toISOString(),
    contentExpiresAt: input.contentExpiresAt.toISOString(),
    contentTtlSeconds: ttlSeconds,
    authorizationLease: input.authorizationLease,
    period,
    sourceHealth: sourceHealth(index, currentDates, totalImpressions.current),
    headlines: Object.freeze({
      totalProfileImpressions: totalImpressions.metric,
      websiteClicks: website.metric,
      callClicks: calls.metric,
      directionRequests: directions.metric,
    }),
    discoverySeries: Object.freeze([
      series('search', 'Search impressions', currentDates, search.current),
      series('maps', 'Maps impressions', currentDates, maps.current),
    ]),
    actionSeries: Object.freeze([
      series('website_clicks', 'Website clicks', currentDates, website.current),
      series('call_clicks', 'Call clicks', currentDates, calls.current),
      series(
        'direction_requests',
        'Direction requests',
        currentDates,
        directions.current,
      ),
    ]),
    additionalInteractions: Object.freeze(additional),
  })
}
