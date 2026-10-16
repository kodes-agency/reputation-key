// Property Google rating goal — when a goal arrives, in days (pure, exact).
//
// Round 5 (2026-10-16, PLAN-D E1): one arrival rule for the setup and for
// tracking, so the card never contradicts the receipt the setup just showed.
// A goal arrives after the reviews it needs at an average, at a pace: a central
// time, and a likely range whose fast end is the average 0.1★ better (never
// above five stars) at a pace 10% faster, and whose slow end is 0.1★ worse at
// 10% slower, open when 0.1★ worse no longer clears the goal by 0.15★ (the
// setup's margin, `minimumQualityTenths`). A pace is a count of reviews per a
// number of days: the chosen one is tenths a week per 70 days, the actual one
// the reviews of the last 28 days per 28, so both stay exact integers and no
// float decides a branch (PLAN-R4 D15). Months were retired with this rule.
//
// The card counts to the next number Google can show, which skips a tenth the
// cache already clears while Google lags (D28): with Google at 4.3, the exact
// average at 4.36 and a goal of 4.5 it counts to 4.5, never "0 to 4.4".

import {
  FORECAST_MIX_DRIFT_THOUSANDTHS,
  FORECAST_PACE_DRIFT_PERCENT,
} from './rating-goal-forecast'
import {
  compareRatios,
  FIVE_STARS,
  fromThousandths,
  ratio,
  reviewsNeeded,
  shiftByThousandths,
  thresholdThousandths,
  type Ratio,
} from './rating-goal-numbers'
import { PACE_WINDOW_DAYS } from './rating-goal-pace'
import { minimumQualityTenths } from './rating-goal-quality'
import {
  HIGHEST_TARGET_TENTHS,
  PERFECT_TENTHS,
  type RatingGoalNumbers,
} from './rating-goal-stops'

/** Days as an integer fraction. */
export type DayFraction = Readonly<{ num: number; den: number }>

/** Reviews per a number of days: both whole, so a duration stays exact. */
export type PaceRate = Readonly<{ reviews: number; perDays: number }>

/** Days in a week, in the tenths a pace is stored in: one review a week is 10. */
const DAYS_PER_TENTHS_A_WEEK = 70
const PERCENT = 100

/** A chosen pace in tenths of a review a week. */
export const chosenRate = (tenthsPerWeek: number): PaceRate => ({
  reviews: tenthsPerWeek,
  perDays: DAYS_PER_TENTHS_A_WEEK,
})

/** The pace of the last 28 days. */
export const actualRate = (reviewsLast28Days: number): PaceRate => ({
  reviews: reviewsLast28Days,
  perDays: PACE_WINDOW_DAYS,
})

export type Arrival =
  /** The average does not clear the goal: no pace reaches it. */
  | Readonly<{ kind: 'unreachable' }>
  /** No reviews at this pace. */
  | Readonly<{ kind: 'no_pace' }>
  /** The cache already clears the goal; Google lags behind it. */
  | Readonly<{ kind: 'earned' }>
  /** The central time and the likely range; `slow` is null when it is open. */
  | Readonly<{
      kind: 'days'
      central: DayFraction
      fast: DayFraction
      slow: DayFraction | null
    }>

/** Reviews needed for a goal at an average; null when the average never gets there. */
function needAt(
  numbers: RatingGoalNumbers,
  targetTenths: number,
  mix: Ratio,
): number | null {
  const needed = reviewsNeeded({
    reviewCount: numbers.reviewCount,
    exact: numbers.exact,
    thresholdThousandths: thresholdThousandths(targetTenths),
    mix,
  })
  return needed === 'unreachable' ? null : needed
}

/** An average clears a goal by 0.15★, as a plan for it must (the setup's margin). */
const clears = (targetTenths: number, mix: Ratio): boolean =>
  compareRatios(mix, ratio(minimumQualityTenths(targetTenths), 10)) >= 0

/** The days a count of reviews takes at a pace scaled by `percent` / 100. */
const daysFor = (reviews: number, rate: PaceRate, percent = PERCENT): DayFraction => ({
  num: reviews * rate.perDays * PERCENT,
  den: rate.reviews * percent,
})

const atMostFiveStars = (mix: Ratio): Ratio =>
  compareRatios(mix, FIVE_STARS) > 0 ? FIVE_STARS : mix

/** When a goal arrives at an average and a pace, or why it does not. */
export function arrivalDays(
  numbers: RatingGoalNumbers,
  targetTenths: number,
  mix: Ratio,
  rate: PaceRate,
): Arrival {
  if (rate.reviews === 0) return { kind: 'no_pace' }
  const central = needAt(numbers, targetTenths, mix)
  if (central === null) return { kind: 'unreachable' }
  if (central === 0) return { kind: 'earned' }
  const better = atMostFiveStars(shiftByThousandths(mix, FORECAST_MIX_DRIFT_THOUSANDTHS))
  const worse = shiftByThousandths(mix, -FORECAST_MIX_DRIFT_THOUSANDTHS)
  const fastNeed = needAt(numbers, targetTenths, better) ?? central
  const slowNeed = clears(targetTenths, worse)
    ? needAt(numbers, targetTenths, worse)
    : null
  return {
    kind: 'days',
    central: daysFor(central, rate),
    fast: daysFor(fastNeed, rate, PERCENT + FORECAST_PACE_DRIFT_PERCENT),
    slow:
      slowNeed === null
        ? null
        : daysFor(slowNeed, rate, PERCENT - FORECAST_PACE_DRIFT_PERCENT),
  }
}

export type NextUp = Readonly<{
  targetTenths: number
  /** Reviews from today to the number above the goal. */
  total: number
  /** Of those, the ones after the goal itself. */
  beyond: number
  days: DayFraction
}>

/**
 * The number above the goal, "possible in about N" (R4-4): offered while it is
 * a target at all, the average clears it by 0.15★ and there is a pace.
 */
export function nextUpAbove(
  numbers: RatingGoalNumbers,
  targetTenths: number,
  mix: Ratio,
  rate: PaceRate,
): NextUp | null {
  const up = targetTenths + 1
  if (up > HIGHEST_TARGET_TENTHS || rate.reviews === 0 || !clears(up, mix)) return null
  const total = needAt(numbers, up, mix)
  const toGoal = needAt(numbers, targetTenths, mix)
  if (total === null || toGoal === null) return null
  return { targetTenths: up, total, beyond: total - toGoal, days: daysFor(total, rate) }
}

/**
 * The highest tenth the exact average already clears (Google lags behind the
 * cache, D28), else the shown one. A goal there needs no review, so none is.
 */
export function earnedTenths(numbers: RatingGoalNumbers): number {
  let earned = numbers.displayedTenths
  while (
    earned < PERFECT_TENTHS &&
    compareRatios(numbers.exact, fromThousandths(thresholdThousandths(earned + 1))) >= 0
  ) {
    earned++
  }
  return earned
}

export type NextNumber = Readonly<{
  /** The number the card counts to: the tenth above what is earned, at most the goal. */
  targetTenths: number
  /** A tenth the cache clears and Google does not show yet; null when there is none. */
  soonTenths: number | null
}>

/** The next number a goal climbs to, or null once the reviews have earned the goal. */
export function nextNumber(
  numbers: RatingGoalNumbers,
  targetTenths: number,
): NextNumber | null {
  const earned = earnedTenths(numbers)
  if (earned >= targetTenths) return null
  return {
    targetTenths: Math.min(targetTenths, earned + 1),
    soonTenths: earned > numbers.displayedTenths ? earned : null,
  }
}
