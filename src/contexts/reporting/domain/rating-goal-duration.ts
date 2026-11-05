// Setup and tracking share arrival ranges. Recommend the highest target reached
// within six months at quality 0.1★ below plan, at least the next target.
// Days stay exact: reviews × 70 ≤ 182 × pace tenths decides six months.

import { FORECAST_MIX_DRIFT_THOUSANDTHS } from './rating-goal-forecast'
import { ratio } from './rating-goal-numbers'
import type { PaceChip } from './rating-goal-pace-chips'
import { reachableAt } from './rating-goal-average'
import { arrivalDays, chosenRate, type DayFraction } from './rating-goal-arrival'
import { planNeeds, type RatingGoalNumbers } from './rating-goal-stops'

/** "Within six months". */
export const SIX_MONTHS_DAYS = 182
/** Days in a week, in the tenths a pace is stored in: one review a week is 10. */
const DAYS_PER_REVIEW_A_WEEK = 70
/** The average drift of the likely range in tenths (0.1★). */
const DRIFT_TENTHS = FORECAST_MIX_DRIFT_THOUSANDTHS / 100

/** The days a count of reviews takes at a pace in tenths a week. */
export const daysAt = (reviews: number, tenthsPerWeek: number): DayFraction => ({
  num: reviews * DAYS_PER_REVIEW_A_WEEK,
  den: tenthsPerWeek,
})

/** True when the reviews arrive within `days` at the pace. */
export const withinDays = (
  reviews: number,
  tenthsPerWeek: number,
  days: number,
): boolean => reviews * DAYS_PER_REVIEW_A_WEEK <= days * tenthsPerWeek

/** Reviews needed for a goal at an average; null when the average never gets there. */
function needAt(numbers: RatingGoalNumbers, targetTenths: number, qualityTenths: number) {
  const needed = planNeeds(numbers, targetTenths, qualityTenths).reviewsNeeded
  return needed === 'unreachable' ? null : needed
}

/**
 * The likely range's ends at a planned average and a chosen pace; `slow` is
 * null (open) when 0.1★ less never gets there. The one arrival rule
 * (`arrivalDays`); a goal the setup offers always needs reviews, so its
 * arrival is always in days.
 */
export function likelyDays(
  numbers: RatingGoalNumbers,
  targetTenths: number,
  qualityTenths: number,
  tenthsPerWeek: number,
): Readonly<{ fast: DayFraction; slow: DayFraction | null }> {
  const arrival = arrivalDays(
    numbers,
    targetTenths,
    ratio(qualityTenths, 10),
    chosenRate(tenthsPerWeek),
  )
  if (arrival.kind !== 'days') {
    throw new RangeError(`A goal the setup offers arrives in days: ${targetTenths}`)
  }
  return { fast: arrival.fast, slow: arrival.slow }
}

/**
 * The highest goal from `minTenths` up that 0.1★ below plan still reaches within
 * six months; the scan runs on while 0.1★ below reaches the goal at all, as the
 * mock's does. Else the lowest goal, `safe: false`.
 */
export function recommendedGoal(
  numbers: RatingGoalNumbers,
  minTenths: number,
  qualityTenths: number,
  tenthsPerWeek: number,
): Readonly<{ targetTenths: number; safe: boolean }> {
  const worse = qualityTenths - DRIFT_TENTHS
  let recommended: number | null = null
  for (
    let target = minTenths;
    reachableAt(numbers.displayedTenths, target, worse);
    target++
  ) {
    const needed = needAt(numbers, target, worse)
    if (needed !== null && withinDays(needed, tenthsPerWeek, SIX_MONTHS_DAYS)) {
      recommended = target
    }
  }
  return recommended === null
    ? { targetTenths: minTenths, safe: false }
    : { targetTenths: recommended, safe: true }
}

/**
 * The chip the status suggests when a goal is more than six months away: the
 * first faster one that gets there within six months, else the fastest; none
 * when the goal is within six months or no chip is faster.
 */
export function fasterPaceChip(
  reviews: number,
  tenthsPerWeek: number,
  chips: readonly PaceChip[],
): number | null {
  if (withinDays(reviews, tenthsPerWeek, SIX_MONTHS_DAYS)) return null
  const first = chips.findIndex(
    (chip) =>
      chip.tenthsPerWeek > tenthsPerWeek &&
      withinDays(reviews, chip.tenthsPerWeek, SIX_MONTHS_DAYS),
  )
  const pick = first >= 0 ? first : chips.length - 1
  const chip = chips[pick]
  return chip !== undefined && chip.tenthsPerWeek > tenthsPerWeek ? pick : null
}
