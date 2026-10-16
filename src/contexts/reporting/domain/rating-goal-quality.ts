// Property Google rating goal — the planned quality of new reviews (pure).
//
// A plan assumes the average stars new Google reviews will bring: its planned
// quality, a tenth of a star (round 2, 2026-10-15). It must clear the target's
// threshold by 0.15★ or more, because reviews needed = gap / (quality − θ)
// explodes near the threshold (4.5★ against 4.45 asks for about five times the
// reviews 4.7★ does); as a tenth that is the target plus one. Rounds 3 and 4
// (2026-10-16) plan it automatically from the best month or year
// (rating-goal-average.ts); this module keeps the floor, the tenth of an
// average and the best calendar year.

import {
  compareRatios,
  ratio,
  thresholdThousandths,
  type Ratio,
  type RatingTotals,
} from './rating-goal-numbers'
import { PERFECT_TENTHS } from './rating-goal-stops'

/** A planned quality clears the target's threshold by at least this much (0.15★). */
const QUALITY_MARGIN_THOUSANDTHS = 150
/** A calendar year counts as evidence with at least this many reviews. */
const BEST_YEAR_MINIMUM_REVIEWS = 10
/** One calendar year of reviews: its count and star sum. */
export type YearTotals = RatingTotals & Readonly<{ year: number }>

export type BestYear = Readonly<{ year: number; average: Ratio; reviewCount: number }>

/** An average as a tenth, rounded half up, exactly: 4.46 is 45. */
export const nearestTenth = (value: Ratio): number =>
  Number((20n * value.num + value.den) / (2n * value.den))

/** A count of thousandths as a tenth, rounded up. */
const tenthAtOrAbove = (thousandths: number): number => Math.ceil(thousandths / 100)

/** The lowest planned quality for a target: its threshold + 0.15★, as a tenth. */
export const minimumQualityTenths = (targetTenths: number): number =>
  tenthAtOrAbove(thresholdThousandths(targetTenths) + QUALITY_MARGIN_THOUSANDTHS)

/** A climb goal's planned quality: a whole tenth from its floor to five stars. */
export function qualityProblem(
  targetTenths: number,
  qualityTenths: number,
): 'invalid_quality' | null {
  return Number.isInteger(qualityTenths) &&
    qualityTenths >= minimumQualityTenths(targetTenths) &&
    qualityTenths <= PERFECT_TENTHS
    ? null
    : 'invalid_quality'
}

/** The calendar year with the highest average among those with ten reviews; the later on a tie. */
export function bestYear(years: readonly YearTotals[]): BestYear | null {
  let best: BestYear | null = null
  for (const year of years) {
    if (year.count < BEST_YEAR_MINIMUM_REVIEWS) continue
    const average = ratio(year.sum, year.count)
    const order = best === null ? 1 : compareRatios(average, best.average)
    if (best === null || order > 0 || (order === 0 && year.year > best.year)) {
      best = { year: year.year, average, reviewCount: year.count }
    }
  }
  return best
}
