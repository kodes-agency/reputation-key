// The one time window the dashboard's topic pages share.
//
// Before this module each dashboard surface carried its own presets — the
// property overview offered 7/30/60/90/All, the Google block inside it offered
// 7/30/90/180 from a second picker, and insights offered 30/90/180/All. Three
// controls, three vocabularies, and one section ("what guests talk about") that
// honoured none of them. See docs/plan/dashboard-redesign.md row 6.
//
// The canonical URL value is the reporting context's preset string, because it
// maps directly onto `TimeRangePreset` (ratings) and `PropertyPerformancePreset`
// (Google); the AI contexts' numeric range is derived here too. Adapters for
// each consumer live beside the type they adapt to, so a source that cannot
// honour a range says so in one line instead of growing a second picker.
import { z } from 'zod/v4'

export const DASHBOARD_RANGES = ['30d', '90d', '180d', 'all'] as const

export type DashboardRange = (typeof DASHBOARD_RANGES)[number]

/** Sentence case, spelled the way a manager reads it: "6 months", not "180 days". */
export const DASHBOARD_RANGE_LABELS: Readonly<Record<DashboardRange, string>> = {
  '30d': '30 days',
  '90d': '90 days',
  '180d': '6 months',
  all: 'All time',
}

export const DASHBOARD_RANGE_OPTIONS: ReadonlyArray<{
  value: DashboardRange
  label: string
}> = DASHBOARD_RANGES.map((value) => ({ value, label: DASHBOARD_RANGE_LABELS[value] }))

/**
 * 90 days is the default because Overview already *is* the 30-day reading
 * (row 5): the topic pages exist to show movement, and 30 days of six-property
 * review data is often three data points. `.catch` keeps a hand-edited URL
 * loading the page rather than throwing a search-validation error.
 */
export const DASHBOARD_RANGE_DEFAULT: DashboardRange = '90d'

export const dashboardRangeSearch = z
  .enum(DASHBOARD_RANGES)
  .catch(DASHBOARD_RANGE_DEFAULT)
  .default(DASHBOARD_RANGE_DEFAULT)

/** Day count, or null for the unbounded window. */
export function dashboardRangeDays(range: DashboardRange): number | null {
  if (range === 'all') return null
  return range === '30d' ? 30 : range === '90d' ? 90 : 180
}

/**
 * Comparison phrase for a delta, or null when there is nothing to compare
 * against. Every bounded range compares with the same length immediately
 * before it; `all` has no prior window (see `priorPeriodDates`, which returns
 * null rather than fabricating a 0 % trend).
 */
export function dashboardRangeComparisonLabel(range: DashboardRange): string | null {
  if (range === 'all') return null
  return `vs the previous ${DASHBOARD_RANGE_LABELS[range].toLowerCase()}`
}

/**
 * Bucket width for a time series in this range (row 9). Daily buckets past
 * 30 days produce the flat-line-with-blips charts the survey found; monthly
 * buckets under 6 months produce three bars.
 */
export type BucketUnit = 'day' | 'week' | 'month'

export function bucketUnitForRange(range: DashboardRange): BucketUnit {
  if (range === '30d') return 'day'
  if (range === 'all') return 'month'
  return 'week'
}

// ── Adapters ──
//
// Structural unions, not imported context types: this module sits under
// `#/shared` and must not depend on a context's DTO. Each consumer's own type
// is assignable from what these return, so a drift in either direction is a
// type error at the call site.

/**
 * The reporting context's `TimeRangePreset` is a superset of `DashboardRange`
 * (it also carries the 7- and 60-day presets that portal analytics still
 * offers), so a dashboard range is passed through unchanged.
 */

/**
 * Google performance reaches back six months and no further, so `all` clamps
 * to its limit; the page states that with `RangeLimitNote` rather than
 * offering a narrower picker.
 */
export const GOOGLE_PERFORMANCE_RANGE_LIMIT: DashboardRange = '180d'

export function toPerformancePreset(range: DashboardRange): '30d' | '90d' | '180d' {
  return range === 'all' ? '180d' : range
}

/** The AI contexts count days as a number and spell the unbounded window `all`. */
export function toInsightsRange(range: DashboardRange): 30 | 90 | 180 | 'all' {
  if (range === 'all') return 'all'
  return range === '30d' ? 30 : range === '90d' ? 90 : 180
}
