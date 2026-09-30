// Reporting domain — the weekly series behind a Portal's Results tab.
//
// A window is cut into weekly buckets anchored to its own start (not to a
// calendar week), so "1-30 Sep" reads 1-7, 8-14, 15-21, 22-28 and a last,
// shorter 29-30. The prior window is cut the same way from its start, so bucket
// i of one sits against bucket i of the other.
//
// What a bucket says is decided here, once, so the chart only draws it:
//   - scans are a count, and stay null (never zero) while the measure's
//     evidence is not ready;
//   - an average is SUM over COUNT of the bucket's own ratings, never a mean of
//     daily means, and is held back below the average floor;
//   - the prior figure is left out when the prior window predates the measure.
// Days are Property-local calendar days, as `property_local_date` records them.
// Pure: only `shared/domain` is imported.

import { propertyWallClockAt } from '#/shared/domain/property-calendar'

export const SERIES_BUCKET_DAYS = 7

const QUALIFIED_SCAN_KEY = 'portal.qualified_scan'
const RATING_KEY = 'portal.rating'

/** One bucket's governed sum for one measure, as the store reports it. */
export type SeriesReadingRow = Readonly<{
  /** Zero-based week of the window the reading's local date falls in. */
  bucket: number
  metricKey: string
  total: number
  count: number
}>

export type PortalSeriesWeek = Readonly<{
  index: number
  /** Property-local dates, `YYYY-MM-DD`; the end is inclusive. */
  startLocalDate: string
  endLocalDate: string
  /** Days the bucket covers: 7, or fewer for the last one. */
  days: number
  /** Qualified scans. Null while the scan evidence is not ready. */
  scans: number | null
  /** The prior window's scans in the same bucket. Null when not comparable. */
  priorScans: number | null
  /** Eligible private ratings in the bucket. Null while ratings are not ready. */
  ratings: number | null
  /** Sum over count; null below the floor or while ratings are not ready. */
  average: number | null
  /**
   * Why there is no average: too few ratings to average, or the ratings are
   * not ready (updating, unavailable). Only the first is a statement about the
   * bucket's ratings. Null while the average is shown.
   */
  averageWithheld: 'below_floor' | 'not_ready' | null
}>

export type PortalResultsSeries = Readonly<{
  weeks: readonly PortalSeriesWeek[]
}>

/** A published version becoming live, placed on the local day it happened. */
export type PortalVersionMarker = Readonly<{
  version: number
  kind: 'publish' | 'rollback'
  activatedAt: Date
  localDate: string
  /** The bucket the day falls in. */
  week: number
  /** Zero-based day within that bucket. */
  dayInWeek: number
}>

export type SeriesWindow = Readonly<{
  startDate: Date
  endDate: Date
  rows: readonly SeriesReadingRow[]
}>

export type SeriesReadiness = Readonly<{
  scans: boolean
  ratings: boolean
  /** The prior window's scans are comparable (ready, and counted that early). */
  priorScans: boolean
}>

export type BuildPortalResultsSeriesInput = Readonly<{
  timezone: string
  current: SeriesWindow
  prior: SeriesWindow | null
  ready: SeriesReadiness
  averageMinSample: number
}>

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The Property-local calendar date of an instant, as `YYYY-MM-DD`. */
export function localDateOf(date: Date, timezone: string): string {
  const { year, month, day } = propertyWallClockAt(date, timezone)
  return `${year}-${pad(month)}-${pad(day)}`
}

function utcDay(localDate: string): number {
  const [year = 0, month = 1, day = 1] = localDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

const MS_PER_DAY = 86_400_000

export function addLocalDays(localDate: string, days: number): string {
  const moved = new Date(utcDay(localDate) + days * MS_PER_DAY)
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

function daysBetween(fromLocalDate: string, toLocalDate: string): number {
  return Math.round((utcDay(toLocalDate) - utcDay(fromLocalDate)) / MS_PER_DAY)
}

/** The first and last Property-local day of a half-open window, for its label. */
export function localDayRange(
  startDate: Date,
  endDate: Date,
  timezone: string,
): Readonly<{ start: string; end: string }> {
  return {
    start: localDateOf(startDate, timezone),
    end: localDateOf(new Date(endDate.getTime() - 1), timezone),
  }
}

/** Local calendar days a half-open window touches: its end instant is not in it. */
export function windowLocalDays(
  startDate: Date,
  endDate: Date,
  timezone: string,
): number {
  const first = localDateOf(startDate, timezone)
  const last = localDateOf(new Date(endDate.getTime() - 1), timezone)
  return Math.max(1, daysBetween(first, last) + 1)
}

function roundedAverage(total: number, count: number): number {
  return Math.round((total / count) * 10) / 10
}

function sumOf(
  rows: readonly SeriesReadingRow[],
  bucket: number,
  metricKey: string,
): SeriesReadingRow | undefined {
  return rows.find((row) => row.bucket === bucket && row.metricKey === metricKey)
}

export function buildPortalResultsSeries(
  input: BuildPortalResultsSeriesInput,
): PortalResultsSeries {
  const { timezone, current, prior, ready, averageMinSample } = input
  const startLocalDate = localDateOf(current.startDate, timezone)
  const totalDays = windowLocalDays(current.startDate, current.endDate, timezone)
  const bucketCount = Math.ceil(totalDays / SERIES_BUCKET_DAYS)

  const weeks = Array.from({ length: bucketCount }, (_, index): PortalSeriesWeek => {
    const offset = index * SERIES_BUCKET_DAYS
    const days = Math.min(SERIES_BUCKET_DAYS, totalDays - offset)
    const scans = sumOf(current.rows, index, QUALIFIED_SCAN_KEY)
    const rating = sumOf(current.rows, index, RATING_KEY)
    const ratingCount = rating?.count ?? 0
    const priorScans = prior && sumOf(prior.rows, index, QUALIFIED_SCAN_KEY)
    const average =
      ready.ratings && rating && ratingCount >= averageMinSample
        ? roundedAverage(rating.total, ratingCount)
        : null
    return {
      index,
      startLocalDate: addLocalDays(startLocalDate, offset),
      endLocalDate: addLocalDays(startLocalDate, offset + days - 1),
      days,
      scans: ready.scans ? (scans?.total ?? 0) : null,
      priorScans:
        prior !== null && ready.scans && ready.priorScans
          ? (priorScans?.total ?? 0)
          : null,
      ratings: ready.ratings ? ratingCount : null,
      average,
      averageWithheld:
        average !== null ? null : ready.ratings ? 'below_floor' : 'not_ready',
    }
  })
  return { weeks }
}

export type PortalVersionActivation = Readonly<{
  version: number
  kind: 'publish' | 'rollback'
  activatedAt: Date
}>

/** Where a version going live sits in the window, or null when it is outside it. */
export function placeVersionMarker(
  activation: PortalVersionActivation,
  startDate: Date,
  endDate: Date,
  timezone: string,
): PortalVersionMarker | null {
  if (activation.activatedAt < startDate || activation.activatedAt >= endDate) return null
  const localDate = localDateOf(activation.activatedAt, timezone)
  const offset = daysBetween(localDateOf(startDate, timezone), localDate)
  return {
    version: activation.version,
    kind: activation.kind,
    activatedAt: activation.activatedAt,
    localDate,
    week: Math.floor(offset / SERIES_BUCKET_DAYS),
    dayInWeek: offset % SERIES_BUCKET_DAYS,
  }
}
