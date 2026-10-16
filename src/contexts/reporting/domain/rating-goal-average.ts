// Property Google rating goal — the average new reviews are planned at (pure).
//
// Rounds 3 and 4 (2026-10-16, R4-1 and R4-3): a plan never assumes new reviews
// at a Property's own rating. Most Properties never asked, so their history is
// mostly unasked reviews, and asked guests rate higher. The automatic average
// is the better of the Property's best evidence (its best calendar month or
// year with ten reviews, as a tenth; a tie goes to the month, the more recent)
// and halfway between the shown number and five stars, rounded half up, and
// never above 4.8. A manager may type their own, from two tenths above the
// shown number to 5.0; it is clamped, never refused. A goal is reachable at an
// average that clears it by a tenth (`qualityProblem`, the one home of that
// rule), so the goals run from the tenth above what Google shows (or above
// what the cache has already earned, D28) to the highest that average reaches.

import { nearestTenth, qualityProblem, type BestYear } from './rating-goal-quality'
import type { BestMonth } from './rating-goal-evidence'
import { HIGHEST_TARGET_TENTHS, PERFECT_TENTHS } from './rating-goal-stops'

/** The automatic average never plans above 4.8 (R4-1). */
export const AUTOMATIC_AVERAGE_CAP_TENTHS = 48
/** A typed average starts two tenths above the shown number: the next goal needs one. */
const OWN_AVERAGE_STEP_TENTHS = 2

export type AverageEvidence =
  | Readonly<{ kind: 'best_month'; year: number; month: number; tenths: number }>
  | Readonly<{ kind: 'best_year'; year: number; tenths: number }>

export type AutomaticAverageSource = AverageEvidence['kind'] | 'halfway'

/** Halfway between the shown tenth and 5.0, half up: 3.9 plans 4.5. */
export const halfwayTenths = (shownTenths: number): number =>
  Math.floor((shownTenths + PERFECT_TENTHS + 1) / 2)

/** The better tenth of the best month and the best year; the month on a tie. */
export function bestEvidence(
  month: BestMonth | null,
  year: BestYear | null,
): AverageEvidence | null {
  const monthTenths = month === null ? null : nearestTenth(month.average)
  const yearTenths = year === null ? null : nearestTenth(year.average)
  if (month !== null && monthTenths !== null && monthTenths >= (yearTenths ?? 0)) {
    return {
      kind: 'best_month',
      year: month.year,
      month: month.month,
      tenths: monthTenths,
    }
  }
  if (year === null || yearTenths === null) return null
  return { kind: 'best_year', year: year.year, tenths: yearTenths }
}

/** The average a plan assumes without the manager: evidence or halfway, at most 4.8. */
export function automaticAverage(
  shownTenths: number,
  evidence: AverageEvidence | null,
): Readonly<{ tenths: number; source: AutomaticAverageSource }> {
  const halfway = halfwayTenths(shownTenths)
  const fromEvidence = evidence !== null && evidence.tenths >= halfway
  return {
    tenths: Math.min(
      AUTOMATIC_AVERAGE_CAP_TENTHS,
      fromEvidence ? evidence.tenths : halfway,
    ),
    source: fromEvidence ? evidence.kind : 'halfway',
  }
}

/** The lowest average a manager may type: two tenths above `aboveTenths`, at most 5.0. */
export const ownAverageFloor = (aboveTenths: number): number =>
  Math.min(PERFECT_TENTHS, aboveTenths + OWN_AVERAGE_STEP_TENTHS)

/**
 * A typed average (4.5) as a tenth from its floor to 5.0, and whether it had to
 * move to get there. Nothing readable is the floor.
 */
export function ownAverageTenths(
  shownTenths: number,
  typed: number | null,
): Readonly<{ tenths: number; clamped: boolean }> {
  const floor = ownAverageFloor(shownTenths)
  if (typed === null || !Number.isFinite(typed)) return { tenths: floor, clamped: true }
  const raw = Math.round(typed * 10)
  const tenths = Math.min(PERFECT_TENTHS, Math.max(floor, raw))
  return { tenths, clamped: tenths !== raw }
}

/** A goal above the shown tenth, at most 4.9, that the average clears by a tenth. */
export const reachableAt = (
  shownTenths: number,
  targetTenths: number,
  qualityTenths: number,
): boolean =>
  targetTenths > shownTenths &&
  targetTenths <= HIGHEST_TARGET_TENTHS &&
  qualityProblem(targetTenths, qualityTenths) === null

/** The goals one average offers: from the tenth above what is earned to the highest it reaches. */
export function goalRange(
  shownTenths: number,
  earnedTenths: number,
  qualityTenths: number,
): Readonly<{ minTenths: number; maxTenths: number }> {
  const minTenths = Math.max(shownTenths, earnedTenths) + 1
  let maxTenths = minTenths
  while (reachableAt(shownTenths, maxTenths + 1, qualityTenths)) maxTenths++
  return { minTenths, maxTenths }
}
