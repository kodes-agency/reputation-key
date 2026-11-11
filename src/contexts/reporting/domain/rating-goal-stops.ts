// Climb targets run from the next shown tenth to 4.9: 5.0 would require every
// future review to be five stars. Keep is offered from shown 4.7 because the next
// tenth needs nearly five-star reviews. Recommend arrival through rating-goal-duration.ts.

import {
  bestCaseReviewsNeeded,
  ratio,
  reviewsNeeded,
  thresholdThousandths,
  type Ratio,
  type ReviewsNeeded,
} from './rating-goal-numbers'

/** A rating goal needs at least this many Google reviews. */
export const MIN_GOOGLE_REVIEWS_FOR_RATING_GOAL = 10
/** The highest target a manager can pick (4.9). */
export const HIGHEST_TARGET_TENTHS = 49
/** 5.0: never a target. */
export const PERFECT_TENTHS = 50

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
 * expected to average: a goal's planned quality blended with the reviews
 * since it was set, or their own average while they are too low
 * (rating-goal-status.ts trackingMix).
 */
export type RatingGoalBasis = RatingGoalNumbers & Readonly<{ mix: Ratio }>

export type RatingGoalEligibility =
  | Readonly<{ eligible: true }>
  /** The Property is not active (suspended, archived, on its way out). */
  | Readonly<{ eligible: false; reason: 'property_not_active' }>
  | Readonly<{ eligible: false; reason: 'few_reviews'; reviewCount: number }>
  | Readonly<{ eligible: false; reason: 'waiting_for_google' }>

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

export type PlanNeeds = Readonly<{
  reviewsNeeded: ReviewsNeeded
  bestCase: ReviewsNeeded
}>

/** Reviews needed at a planned quality, and if every new review is five stars. */
export function planNeeds(
  numbers: RatingGoalNumbers,
  targetTenths: number,
  qualityTenths: number,
): PlanNeeds {
  const plan = {
    reviewCount: numbers.reviewCount,
    exact: numbers.exact,
    thresholdThousandths: thresholdThousandths(targetTenths),
  }
  return {
    reviewsNeeded: reviewsNeeded({ ...plan, mix: ratio(qualityTenths, 10) }),
    bestCase: bestCaseReviewsNeeded(plan),
  }
}

/**
 * Keep is offered first from a shown 4.7:
 * at 4.7 the next tenth needs new reviews averaging 4.9★ or more, at 4.8 every
 * one to be 5★. A goal to keep may be set from there, and a climb only with an
 * average the manager types.
 */
export const KEEP_FIRST_FROM_TENTHS = 47

export const offerKeepFirst = (displayedTenths: number): boolean =>
  displayedTenths >= KEEP_FIRST_FROM_TENTHS
