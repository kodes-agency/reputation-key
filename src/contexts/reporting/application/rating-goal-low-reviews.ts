// Property Google rating goal — the detail's per-review rows (round 5, PLAN-D
// D-2b; the owner's exception, ADR 0067 2026-10-17).
//
// "What moved you" names the low reviews since the set with the new reviews
// each one set the goal back (domain/rating-goal-setback.ts), and says this
// week's stars. Both are read live for the goal's managers and kept nowhere.
// The rows still carry Review's id here: the server function turns it into
// the Inbox item that opens it and drops it (rating-goal-inbox-links.server.ts),
// so the browser never sees a review id.
//
// A keep goal has no plan to set back, and a goal the read found reached or
// ended looks ahead no more: neither reads low reviews, nor does a goal
// without Google's numbers (no count to measure a setback against).

import type {
  GoogleRatingLowReview,
  GoogleRatingStarCount,
} from '#/contexts/review/application/public-api'
import { roundHalfUpInt } from '../domain/rating-goal-numbers'
import { whatSetYouBack, type SetbackNumbers } from '../domain/rating-goal-setback'
import type { PropertyRatingGoal } from '../domain/rating-goal'
import type {
  RatingGoalLowReviewRead,
  RatingGoalThisWeekView,
} from './dto/rating-goal.types'
import type { RatingGoalReading } from './rating-goal-reading'
import { goalBasis } from './rating-goal-views'

/** A low-review read names this many at most; the page shows ten of them. */
export const LOW_REVIEW_READ_LIMIT = 25

/** What a setback is measured against today; null when the goal reads no low reviews. */
export function setbackNumbers(
  goal: PropertyRatingGoal,
  reading: RatingGoalReading,
): SetbackNumbers | null {
  if (
    goal.state !== 'active' ||
    goal.qualityTenths === null ||
    reading.sinceSet === null
  ) {
    return null
  }
  const numbers = goalBasis(goal, reading)
  if (numbers === null) return null
  return {
    reviewCount: numbers.basis.reviewCount,
    exact: numbers.basis.exact,
    sinceSet: reading.sinceSet,
    qualityTenths: goal.qualityTenths,
    targetTenths: goal.targetTenths,
  }
}

/** The rows "What moved you" names, newest first: ten at most (whatSetYouBack). */
export function lowReviewRows(
  numbers: SetbackNumbers | null,
  reviews: readonly GoogleRatingLowReview[],
): readonly RatingGoalLowReviewRead[] {
  if (numbers === null) return []
  return whatSetYouBack(numbers, reviews).map((review) => ({
    reviewId: review.reviewId,
    at: review.reviewedAt.toISOString(),
    stars: review.stars,
    setBack: review.setBack,
  }))
}

/** This week's count, their stars when all are the same, and their average as a tenth. */
export function thisWeekView(
  split: readonly GoogleRatingStarCount[],
): RatingGoalThisWeekView {
  const present = split.filter((row) => row.count > 0)
  const count = present.reduce((total, row) => total + row.count, 0)
  if (count === 0) return { count: 0, allStars: null, averageTenths: null }
  const stars = present.reduce((total, row) => total + row.stars * row.count, 0)
  const only = present.length === 1 ? present[0] : undefined
  return {
    count,
    allStars: only === undefined ? null : only.stars,
    averageTenths: roundHalfUpInt(stars * 10, count),
  }
}
