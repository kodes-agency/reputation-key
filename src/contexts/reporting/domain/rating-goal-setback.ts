// Property Google rating goal — what one low review set the goal back (pure, exact).
//
// Round 5 (PLAN-D D-2b, E20; the owner's exception, ADR 0067 2026-10-17): the
// tracking page names the low reviews since the set and says how many new
// reviews each one added to the goal. Since PR C the average the goal assumes
// blends the plan (counted as 15 reviews) with every review since the set, so
// one review moves both Google's average and that blend; a fixed-average
// formula would be off by two to ten times. The setback is therefore a
// counterfactual measured today, against the goal (not the headline's nearer
// number): the count the goal needs now, less the same with that review taken
// off Google's count and star sum and off the totals since the set, with the
// average worked out again by `trackingMix` (its floor before the tenth review
// and its switch to the reviews' own average while they are too low). Both
// counts are un-ceiled ratios, so two ceilings cannot add a review of jitter.

import {
  compareRatios,
  ratio,
  thresholdThousandths,
  type Ratio,
  type RatingTotals,
} from './rating-goal-numbers'
import { trackingMix } from './rating-goal-status'

/** The page names this many low reviews at most. */
const LOW_REVIEW_ROWS = 10

/** Half a review: a setback from here reads "about 1". */
const HALF = ratio(1, 2)

export type SetbackNumbers = Readonly<{
  /** Google's review count. */
  reviewCount: number
  /** The exact average today (the cache's, or Google's own figure). */
  exact: Ratio
  /** The reviews since the set and their star sum. */
  sinceSet: RatingTotals
  qualityTenths: number
  targetTenths: number
}>

/**
 * N(θ − E)/(m − θ), un-ceiled: the new reviews at average m that lift N reviews
 * at exact average E to the threshold θ. Zero once E meets θ; null when m does
 * not exceed θ (no count gets there).
 */
export function needExact(
  reviewCount: number,
  exact: Ratio,
  thresholdThousandthsValue: number,
  mix: Ratio,
): Ratio | null {
  const threshold = ratio(thresholdThousandthsValue, 1000)
  if (compareRatios(exact, threshold) >= 0) return ratio(0, 1)
  if (compareRatios(mix, threshold) <= 0) return null
  const gap = threshold.num * exact.den - exact.num * threshold.den
  const lift = mix.num * threshold.den - threshold.num * mix.den
  return ratio(
    BigInt(reviewCount) * gap * mix.den * threshold.den,
    exact.den * threshold.den * lift,
  )
}

/** What the goal needs today from these numbers; null without a count. */
function needToday(numbers: SetbackNumbers): Ratio | null {
  const { mix } = trackingMix(
    numbers.qualityTenths,
    numbers.sinceSet,
    numbers.targetTenths,
  )
  return needExact(
    numbers.reviewCount,
    numbers.exact,
    thresholdThousandths(numbers.targetTenths),
    mix,
  )
}

/** The same numbers without one review of `stars`; null when they cannot have held it. */
function without(numbers: SetbackNumbers, stars: number): SetbackNumbers | null {
  const { reviewCount, exact, sinceSet } = numbers
  // E·N as a ratio, less the review's stars, over one review fewer.
  const starSum = ratio(exact.num * BigInt(reviewCount), exact.den)
  const remaining = starSum.num - BigInt(stars) * starSum.den
  if (reviewCount < 2 || remaining < 0n) return null
  if (sinceSet.count < 1 || sinceSet.sum < stars) return null
  return {
    ...numbers,
    reviewCount: reviewCount - 1,
    exact: ratio(remaining, starSum.den * BigInt(reviewCount - 1)),
    sinceSet: { count: sinceSet.count - 1, sum: sinceSet.sum - stars },
  }
}

/**
 * The new reviews one review of `stars` since the set added to what the goal
 * needs today, un-rounded (negative when it helped). Null when either count
 * is missing: today's, while new reviews are too low for any count to reach
 * the goal, or the review cannot be taken off the numbers.
 */
export function setbackOf(numbers: SetbackNumbers, stars: number): Ratio | null {
  const today = needToday(numbers)
  const before = without(numbers, stars)
  const withoutIt = before === null ? null : needToday(before)
  if (today === null || withoutIt === null) return null
  return ratio(
    today.num * withoutIt.den - withoutIt.num * today.den,
    today.den * withoutIt.den,
  )
}

/** The low stars a review may have: the owner's 4★ ceiling (Q2). */
const LOW_STARS = [4, 3, 2, 1] as const

/** Whether one review of `stars` sets the goal back about one new review or more. */
const setsBack = (numbers: SetbackNumbers, stars: number): boolean => {
  const setback = setbackOf(numbers, stars)
  return setback !== null && compareRatios(setback, HALF) >= 0
}

/**
 * The bound (thousandths, exclusive) a low-review read should take, or null
 * when no review can be named. A review's setback depends only on its stars
 * given today's numbers, so the read starts at the most stars that still set
 * the goal back half a review: on a busy Property the newest 4★ reviews add
 * almost nothing and would otherwise fill the read ahead of an older 1★ one.
 * While no count reaches the goal, every review under the threshold is named.
 */
export function lowReviewReadBelow(numbers: SetbackNumbers): number | null {
  const threshold = thresholdThousandths(numbers.targetTenths)
  if (needToday(numbers) === null) return threshold
  const most = LOW_STARS.find((stars) => setsBack(numbers, stars))
  return most === undefined ? null : Math.min(threshold, (most + 1) * 1000)
}

/** A positive ratio as a whole number, half up. */
const wholeHalfUp = (value: Ratio): number =>
  Number((2n * value.num + value.den) / (2n * value.den))

export type WithSetback<R> = R & Readonly<{ setBack: number | null }>

/**
 * The low reviews the page names, newest first, LOW_REVIEW_ROWS at most: those
 * that set the goal back about one new review or more ("about N", half up).
 * While no count reaches the goal (new reviews too low) a setback means
 * nothing, so the newest are named without one.
 */
export function whatSetYouBack<R extends Readonly<{ stars: number }>>(
  numbers: SetbackNumbers,
  reviews: readonly R[],
): readonly WithSetback<R>[] {
  if (needToday(numbers) === null) {
    return reviews
      .slice(0, LOW_REVIEW_ROWS)
      .map((review) => ({ ...review, setBack: null }))
  }
  return reviews
    .flatMap((review) => {
      const setback = setbackOf(numbers, review.stars)
      return setback === null || compareRatios(setback, HALF) < 0
        ? []
        : [{ ...review, setBack: wholeHalfUp(setback) }]
    })
    .slice(0, LOW_REVIEW_ROWS)
}
