// Property Google rating goal — the setup's evidence from the review cache (pure).
//
// Rounds 3 and 4 (2026-10-16) plan new reviews from what a Property has done
// at its best and how busy it has been:
//   - the best calendar month: the highest exact average among the Property's
//     local calendar months from the one 11 months back through the current
//     part month, each with at least ten reviews; the later month on a tie (12
//     distinct month names, so "your best month, August" is never ambiguous);
//   - the busiest 30 days: the most reviews on 30 consecutive Property-local
//     dates within the last 365 local dates, today included. Dates are civil
//     dates, not 24-hour spans, so a change of summer time moves nothing.
// Review answers both reads over generous UTC bounds; the windows are trimmed
// here, in the Property's calendar.

import { propertyWallClockAt } from '#/shared/domain/property-calendar'
import {
  compareRatios,
  ratio,
  type Ratio,
  type RatingTotals,
} from './rating-goal-numbers'

/** A month counts as evidence from this many reviews (the month read's minimum). */
export const EVIDENCE_MIN_REVIEWS = 10
/** The month read's UTC bound, wider than 12 Property-local months. */
export const MONTH_READ_LOOKBACK_DAYS = 400
/** The day read's UTC bound, wider than 365 Property-local dates. */
export const DAY_READ_LOOKBACK_DAYS = 366

/** Months back from the current one that the best month looks at. */
const BEST_MONTH_MONTHS_BACK = 11
/** Local dates the busiest window looks back over, today included. */
const BUSIEST_LOOKBACK_DATES = 365
/** Consecutive local dates in the busiest window. */
const BUSIEST_WINDOW_DATES = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type MonthTotals = RatingTotals & Readonly<{ year: number; month: number }>
export type DayCount = Readonly<{ day: string; count: number }>
export type BestMonth = Readonly<{
  year: number
  month: number
  average: Ratio
  reviewCount: number
}>

/** A calendar month as one ordinal: 12 × year + month − 1. */
const monthOrdinal = (year: number, month: number): number => year * 12 + month - 1

/** The best calendar month of the last twelve, or null without one of ten reviews. */
export function bestMonth(
  months: readonly MonthTotals[],
  now: Date,
  timezone: string,
): BestMonth | null {
  const local = propertyWallClockAt(now, timezone)
  const current = monthOrdinal(local.year, local.month)
  let best: BestMonth | null = null
  for (const totals of months) {
    const ordinal = monthOrdinal(totals.year, totals.month)
    if (ordinal > current || ordinal < current - BEST_MONTH_MONTHS_BACK) continue
    if (totals.count < EVIDENCE_MIN_REVIEWS) continue
    const average = ratio(totals.sum, totals.count)
    const order = best === null ? 1 : compareRatios(average, best.average)
    const later = best !== null && ordinal > monthOrdinal(best.year, best.month)
    if (best === null || order > 0 || (order === 0 && later)) {
      best = {
        year: totals.year,
        month: totals.month,
        average,
        reviewCount: totals.count,
      }
    }
  }
  return best
}

/** A civil date `YYYY-MM-DD` as a day number. */
const civilDay = (key: string): number => {
  const [year = 0, month = 1, day = 1] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

/** Today's Property-local date as a day number. */
function localToday(now: Date, timezone: string): number {
  const local = propertyWallClockAt(now, timezone)
  return Date.UTC(local.year, local.month - 1, local.day) / DAY_MS
}

/** The most reviews on 30 consecutive local dates of the last 365; 0 without any. */
export function busiestWindowCount(
  days: readonly DayCount[],
  now: Date,
  timezone: string,
): number {
  const today = localToday(now, timezone)
  const first = today - (BUSIEST_LOOKBACK_DATES - 1)
  const series = days
    .map((entry) => ({ day: civilDay(entry.day), count: entry.count }))
    .filter((entry) => entry.day >= first && entry.day <= today)
    .sort((left, right) => left.day - right.day)
  let busiest = 0
  let inWindow = 0
  let start = 0
  for (const entry of series) {
    inWindow += entry.count
    while ((series[start]?.day ?? entry.day) <= entry.day - BUSIEST_WINDOW_DATES) {
      inWindow -= series[start]?.count ?? 0
      start++
    }
    busiest = Math.max(busiest, inWindow)
  }
  return busiest
}
