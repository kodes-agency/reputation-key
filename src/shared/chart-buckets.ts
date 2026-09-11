// Grouping and axis labelling for dashboard time series (redesign row 9).
//
// The seam is deliberate: grouping and labelling are shared, aggregation is
// not. Counts sum, ratings run a cumulative average, Google's daily values may
// be absent rather than zero — a generic reducer would have to be told which
// every time, so each chart aggregates its own buckets and reuses the grouping
// and the ticks.
//
// Local dates are `YYYY-MM-DD` strings already resolved into the property's own
// time zone by the read model. They are compared and split as strings; parsing
// them into `Date` at a fixed UTC midnight is only for labelling, never for
// arithmetic, so no host time zone can shift a bucket across a boundary.
import type { BucketUnit } from './dashboard-range'

export type LocalDate = string

const LABEL_FORMATTERS: Readonly<Record<BucketUnit, Intl.DateTimeFormat>> = {
  day: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }),
  week: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }),
  month: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }),
}

const YEAR_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  timeZone: 'UTC',
})

function atUtcMidnight(localDate: LocalDate): Date {
  return new Date(`${localDate}T00:00:00.000Z`)
}

/** ISO week start (Monday) as a local-date string. */
function startOfWeek(localDate: LocalDate): LocalDate {
  const date = atUtcMidnight(localDate)
  const weekday = date.getUTCDay()
  const backToMonday = weekday === 0 ? 6 : weekday - 1
  date.setUTCDate(date.getUTCDate() - backToMonday)
  return date.toISOString().slice(0, 10)
}

/**
 * The local date that opens the bucket containing `localDate`. Stable and
 * sortable as a string, so it doubles as the bucket's identity.
 */
export function bucketStart(localDate: LocalDate, unit: BucketUnit): LocalDate {
  if (unit === 'day') return localDate
  if (unit === 'week') return startOfWeek(localDate)
  return `${localDate.slice(0, 7)}-01`
}

export type Bucket<T> = Readonly<{
  /** Local date opening the bucket; identity and sort key. */
  start: LocalDate
  /** Axis label — the year is appended on the first bucket of each year. */
  label: string
  rows: ReadonlyArray<T>
}>

/**
 * Group rows into buckets of `unit`, ascending by date, gaps included as empty
 * buckets so a quiet week reads as a gap rather than closing up. `getDate`
 * pulls the local date out of a row; rows whose date is absent are dropped.
 *
 * The year appears on the first bucket of each year — the survey found a
 * ten-year rating axis cycling `10/24 … 9/6` with no year anywhere.
 */
export function groupByBucket<T>(
  rows: ReadonlyArray<T>,
  unit: BucketUnit,
  getDate: (row: T) => LocalDate | null | undefined,
): ReadonlyArray<Bucket<T>> {
  const byStart = new Map<LocalDate, T[]>()
  for (const row of rows) {
    const localDate = getDate(row)
    if (!localDate) continue
    const start = bucketStart(localDate, unit)
    const existing = byStart.get(start)
    if (existing) existing.push(row)
    else byStart.set(start, [row])
  }
  if (byStart.size === 0) return []

  const starts = [...byStart.keys()].sort()
  const filled = fillGaps(starts[0]!, starts[starts.length - 1]!, unit)

  let previousYear: string | null = null
  return filled.map((start) => {
    const year = start.slice(0, 4)
    const showYear = year !== previousYear
    previousYear = year
    const at = atUtcMidnight(start)
    const label = showYear
      ? `${LABEL_FORMATTERS[unit].format(at)} ${YEAR_FORMATTER.format(at)}`
      : LABEL_FORMATTERS[unit].format(at)
    return { start, label, rows: byStart.get(start) ?? [] }
  })
}

function fillGaps(first: LocalDate, last: LocalDate, unit: BucketUnit): LocalDate[] {
  const out: LocalDate[] = []
  const cursor = atUtcMidnight(first)
  const end = atUtcMidnight(last)
  // A bounded window can only hold so many buckets; the guard stops a corrupt
  // date from spinning here rather than trusting the caller's range.
  for (let guard = 0; cursor.getTime() <= end.getTime() && guard < 1_000; guard += 1) {
    out.push(cursor.toISOString().slice(0, 10))
    if (unit === 'day') cursor.setUTCDate(cursor.getUTCDate() + 1)
    else if (unit === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7)
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return out
}

export const MAX_AXIS_TICKS = 8

/**
 * At most `MAX_AXIS_TICKS` labels, evenly spaced, always including the first
 * and last bucket. Recharts is told which ticks to draw rather than being left
 * to overlap them.
 */
export function axisTicks<T>(
  buckets: ReadonlyArray<Bucket<T>>,
  max = MAX_AXIS_TICKS,
): ReadonlyArray<LocalDate> {
  if (buckets.length <= max) return buckets.map((bucket) => bucket.start)
  const step = (buckets.length - 1) / (max - 1)
  const picked = new Set<LocalDate>()
  for (let index = 0; index < max; index += 1) {
    picked.add(buckets[Math.round(index * step)]!.start)
  }
  return [...picked]
}

export const MIN_CHART_BUCKETS = 3

/**
 * A chart earns its place at three or more buckets carrying data. Below that
 * the page prints the figures as a sentence (row 9) — two points drawn as a
 * line invite a reading of a trend that is not there.
 */
export function hasEnoughEvidence<T>(buckets: ReadonlyArray<Bucket<T>>): boolean {
  return buckets.filter((bucket) => bucket.rows.length > 0).length >= MIN_CHART_BUCKETS
}
