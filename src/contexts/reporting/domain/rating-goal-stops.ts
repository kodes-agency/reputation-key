// Property Google rating goal — the targets a manager can pick (pure).
//
// The targets run from the tenth above what Google shows up to 4.9; 5.0 is
// shown disabled, because it needs every review from now on to be five stars.
// A target is labelled from the forecast at the Faster pace: Realistic within
// 26 weeks, Stretch within 52, Out of reach beyond that (stopLabel). Since
// round 2 (2026-10-15) each target is worked out at its own recommended
// planned quality, not at the recent mix: rating-goal-plans.ts builds the
// stops, the recommended target and the plans from this module's rules.

import type { Ratio, ReviewsNeeded } from './rating-goal-numbers'

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

export type RatingStopLabel = 'realistic' | 'stretch' | 'out_of_reach'

/** Google's count, the tenth it shows and the exact average. */
export type RatingGoalNumbers = Readonly<{
  /** Google's review count. */
  reviewCount: number
  /** The tenth Google shows. */
  displayedTenths: number
  exact: Ratio
}>

/**
 * The numbers a goal is worked out from, with the stars new reviews are
 * expected to average: a goal's planned quality until ten reviews arrived
 * since it was set, then their average (rating-goal-status.ts trackingMix).
 */
export type RatingGoalBasis = RatingGoalNumbers & Readonly<{ mix: Ratio }>

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

/**
 * Realistic within 26 weeks at a pace, Stretch within 52, else Out of reach. A
 * target is labelled at the Faster pace; a plan's reach is the same rule at the
 * plan's own pace (round 2).
 */
export function stopLabel(needed: ReviewsNeeded, perWeek: number): RatingStopLabel {
  if (needed === 'unreachable') return 'out_of_reach'
  if (needed <= REALISTIC_WITHIN_WEEKS * perWeek) return 'realistic'
  if (needed <= STRETCH_WITHIN_WEEKS * perWeek) return 'stretch'
  return 'out_of_reach'
}

/** 5.0, disabled with its reason, while Google shows less. */
export const perfectStop = (displayedTenths: number): PerfectStop | null =>
  displayedTenths >= PERFECT_TENTHS
    ? null
    : { targetTenths: PERFECT_TENTHS, disabledReason: 'needs_every_review_5_star' }

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
