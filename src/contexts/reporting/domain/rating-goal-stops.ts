// Property Google rating goal — the targets a manager can pick (pure).
//
// The picker offers every tenth from the one above what Google shows up to
// 4.9; 5.0 is shown disabled, because it needs every review from now on to be
// five stars. Each stop is labelled from the forecast at the Faster pace:
// Realistic within 26 weeks, Stretch within 52, Out of reach beyond that or
// never at the recent mix. Out-of-reach stops stay selectable (the screen
// warns). The picker opens on the highest Realistic stop at most three tenths
// up, otherwise on the next tenth. Keep comes first when there is no higher
// tenth, or when the recent mix does not clear even the next one.

import {
  bestCaseReviewsNeeded,
  compareRatios,
  fromThousandths,
  reviewsNeeded,
  thresholdThousandths,
  type Ratio,
  type ReviewsNeeded,
} from './rating-goal-numbers'

/** A rating goal needs at least this many Google reviews. */
export const MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL = 10
/** A stop is Realistic when the Faster pace gets there within this many weeks. */
const REALISTIC_WITHIN_WEEKS = 26
/** A stop is a Stretch when the Faster pace gets there within this many weeks. */
const STRETCH_WITHIN_WEEKS = 52
/** The highest target a manager can pick (4.9). */
export const HIGHEST_TARGET_TENTHS = 49
/** 5.0: shown, never selectable. */
export const PERFECT_TENTHS = 50
/** The preselected stop is at most this many tenths above what Google shows. */
const PRESELECT_MAX_STEP_TENTHS = 3

export type RatingStopLabel = 'realistic' | 'stretch' | 'out_of_reach'

/** The numbers a plan is worked out from. */
export type RatingGoalBasis = Readonly<{
  /** Google's review count. */
  reviewCount: number
  /** The tenth Google shows. */
  displayedTenths: number
  exact: Ratio
  mix: Ratio
}>

export type RatingStop = Readonly<{
  targetTenths: number
  reviewsNeeded: ReviewsNeeded
  /** Reviews needed if every new review is five stars. */
  bestCase: ReviewsNeeded
  label: RatingStopLabel
}>

export type PerfectStop = Readonly<{
  targetTenths: typeof PERFECT_TENTHS
  disabledReason: 'needs_every_review_5_star'
}>

export type RatingGoalEligibility =
  | Readonly<{ eligible: true }>
  /** The Property is not active (suspended, archived, on its way out). */
  | Readonly<{ eligible: false; reason: 'property_not_active' }>
  | Readonly<{ eligible: false; reason: 'few_reviews'; reviewCount: number }>
  | Readonly<{ eligible: false; reason: 'waiting_for_google' }>

function labelFor(needed: ReviewsNeeded, fasterPerWeek: number): RatingStopLabel {
  if (needed === 'unreachable') return 'out_of_reach'
  if (needed <= REALISTIC_WITHIN_WEEKS * fasterPerWeek) return 'realistic'
  if (needed <= STRETCH_WITHIN_WEEKS * fasterPerWeek) return 'stretch'
  return 'out_of_reach'
}

/** One target's reviews needed, best case and label at the Faster pace. */
function ratingStop(
  basis: RatingGoalBasis,
  targetTenths: number,
  fasterPerWeek: number,
): RatingStop {
  const plan = {
    reviewCount: basis.reviewCount,
    exact: basis.exact,
    thresholdThousandths: thresholdThousandths(targetTenths),
  }
  const needed = reviewsNeeded({ ...plan, mix: basis.mix })
  return {
    targetTenths,
    reviewsNeeded: needed,
    bestCase: bestCaseReviewsNeeded(plan),
    label: labelFor(needed, fasterPerWeek),
  }
}

/** Every selectable stop, from the tenth above what Google shows to 4.9. */
export function ratingStops(basis: RatingGoalBasis, fasterPerWeek: number): RatingStop[] {
  const stops: RatingStop[] = []
  for (
    let tenths = basis.displayedTenths + 1;
    tenths <= HIGHEST_TARGET_TENTHS;
    tenths++
  ) {
    stops.push(ratingStop(basis, tenths, fasterPerWeek))
  }
  return stops
}

/** 5.0, disabled with its reason, while Google shows less. */
export const perfectStop = (displayedTenths: number): PerfectStop | null =>
  displayedTenths >= PERFECT_TENTHS
    ? null
    : { targetTenths: PERFECT_TENTHS, disabledReason: 'needs_every_review_5_star' }

/** The highest Realistic stop at most three tenths up, else the next tenth. */
export function preselectedTarget(
  displayedTenths: number,
  stops: readonly RatingStop[],
): number | null {
  const ceiling = displayedTenths + PRESELECT_MAX_STEP_TENTHS
  const realistic = stops.filter(
    (stop) => stop.label === 'realistic' && stop.targetTenths <= ceiling,
  )
  const highest = realistic.at(-1)
  if (highest) return highest.targetTenths
  return stops[0]?.targetTenths ?? null
}

/** Keep first: no higher tenth, or the recent mix does not clear the next one. */
export function offerKeepFirst(basis: RatingGoalBasis): boolean {
  if (basis.displayedTenths >= HIGHEST_TARGET_TENTHS) return true
  const next = fromThousandths(thresholdThousandths(basis.displayedTenths + 1))
  return compareRatios(basis.mix, next) <= 0
}

/**
 * Rating goals start at ten Google reviews. The count of Google's latest
 * snapshot decides that first, current or not, so a Property with no review
 * (and so no average to plan with) hears how many it has rather than waiting
 * for Google for good. With ten or more, the numbers must be current.
 */
export function ratingGoalEligibility(
  google: Readonly<{ reviewCount: number }> | null,
  numbersCurrent: boolean,
): RatingGoalEligibility {
  if (google !== null && google.reviewCount < MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL) {
    return { eligible: false, reason: 'few_reviews', reviewCount: google.reviewCount }
  }
  if (google === null || !numbersCurrent) {
    return { eligible: false, reason: 'waiting_for_google' }
  }
  return { eligible: true }
}
