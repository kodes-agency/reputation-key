// Property Google rating goal — status, progress and the next tenth (pure).
//
// A climb goal's status, the first rule that holds wins:
//   waiting_for_google  no current snapshot, one older than 24 hours, or the
//                       Google binding is not active
//   reached             Google shows the target
//   reviews_too_low     at least ten reviews arrived since the goal was set,
//                       and their average does not clear the target's
//                       threshold (round 2, 2026-10-15; it replaced "Can't
//                       reach at this mix", which judged the recent mix)
//   getting_started     the goal is younger than 14 days
//   on_pace             reviews in the pace window at 90% of the chosen pace
//   below_pace          otherwise
// The pace window is the last 28 days once the goal is 28 days old, before
// that the days since it was set (only judged from day 14). A keep goal holds
// while Google shows the kept tenth, and waits for Google the same way.
// There is no deadline and no "missed".
//
// Until ten reviews arrived since the goal was set there is no verdict on
// their stars, and the goal's numbers assume its planned quality; from the
// tenth on they assume the average of those reviews (trackingMix).

import {
  compareRatios,
  fromThousandths,
  ratio,
  ratioToNumber,
  reviewsNeeded,
  thresholdThousandths,
  type Ratio,
  type RatingTotals,
  type ReviewsNeeded,
} from './rating-goal-numbers'
import type { RatingGoalBasis } from './rating-goal-stops'
import type { RatingGoalStatus } from './rating-goal'

/** Google's numbers older than this make a goal wait for Google. */
export const GOOGLE_NUMBERS_FRESH_HOURS = 24
/** A goal is getting started (neutral) for this many days. */
const GETTING_STARTED_DAYS = 14
/** The pace window grows until it is this many days long. */
const FULL_PACE_WINDOW_DAYS = 28
/** On pace at this share of the chosen pace or more. */
const ON_PACE_PERCENT = 90
/** New reviews are judged, and plan with their own average, from this many since the set. */
const QUALITY_VERDICT_MIN_REVIEWS = 10

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

export type PaceWindow = Readonly<{ start: Date; end: Date }>

const ageMs = (createdAt: Date, now: Date): number => now.getTime() - createdAt.getTime()

/** True when there is no snapshot, the binding is not active, or the snapshot is stale. */
export function googleIsWaiting(
  google: Readonly<{ verifiedAt: Date }> | null,
  bindingActive: boolean,
  now: Date,
): boolean {
  if (google === null || !bindingActive) return true
  return (
    now.getTime() - google.verifiedAt.getTime() > GOOGLE_NUMBERS_FRESH_HOURS * HOUR_MS
  )
}

/** The window a goal's pace is judged on, or null while it is getting started. */
export function statusPaceWindow(goalCreatedAt: Date, now: Date): PaceWindow | null {
  const age = ageMs(goalCreatedAt, now)
  if (age < GETTING_STARTED_DAYS * DAY_MS) return null
  const start =
    age >= FULL_PACE_WINDOW_DAYS * DAY_MS
      ? new Date(now.getTime() - FULL_PACE_WINDOW_DAYS * DAY_MS)
      : goalCreatedAt
  return { start, end: now }
}

/** The simple card forecasts at the actual pace once the goal is 28 days old. */
export const forecastPaceBasis = (goalCreatedAt: Date, now: Date): 'chosen' | 'actual' =>
  ageMs(goalCreatedAt, now) >= FULL_PACE_WINDOW_DAYS * DAY_MS ? 'actual' : 'chosen'

/** reviews / weeks(window) ≥ 90% × chosen, in integers. */
function isOnPace(reviews: number, window: PaceWindow, chosenPerWeek: number): boolean {
  const windowMs = window.end.getTime() - window.start.getTime()
  return reviews * WEEK_MS * 100 >= ON_PACE_PERCENT * chosenPerWeek * windowMs
}

/** `planned` until ten reviews arrived since the goal was set, then `since_set`. */
export type QualityBasis = 'planned' | 'since_set'

export type TrackingMix = Readonly<{ mix: Ratio; basis: QualityBasis }>

/** The stars new reviews are expected to average: the plan's, then their own from the tenth on. */
export function trackingMix(
  plannedQualityTenths: number,
  sinceSet: RatingTotals,
): TrackingMix {
  return sinceSet.count >= QUALITY_VERDICT_MIN_REVIEWS
    ? { mix: ratio(sinceSet.sum, sinceSet.count), basis: 'since_set' }
    : { mix: ratio(plannedQualityTenths, 10), basis: 'planned' }
}

/** Ten or more reviews since the set average at or below the target's threshold. */
export function reviewsTooLow(sinceSet: RatingTotals, targetTenths: number): boolean {
  if (sinceSet.count < QUALITY_VERDICT_MIN_REVIEWS) return false
  const threshold = fromThousandths(thresholdThousandths(targetTenths))
  return compareRatios(ratio(sinceSet.sum, sinceSet.count), threshold) <= 0
}

export type ClimbStatusInput = Readonly<{
  waiting: boolean
  displayedTenths: number
  targetTenths: number
  /** Reviews created since the goal was set, and their stars. */
  sinceSet: RatingTotals
  goalCreatedAt: Date
  now: Date
  chosenPerWeek: number
  /** Reviews created in `statusPaceWindow`; null while there is none. */
  reviewsInPaceWindow: number | null
}>

export function climbStatus(input: ClimbStatusInput): RatingGoalStatus {
  if (input.waiting) return 'waiting_for_google'
  if (input.displayedTenths >= input.targetTenths) return 'reached'
  if (reviewsTooLow(input.sinceSet, input.targetTenths)) return 'reviews_too_low'
  const window = statusPaceWindow(input.goalCreatedAt, input.now)
  if (window === null || input.reviewsInPaceWindow === null) return 'getting_started'
  return isOnPace(input.reviewsInPaceWindow, window, input.chosenPerWeek)
    ? 'on_pace'
    : 'below_pace'
}

export function keepStatus(
  input: Readonly<{ waiting: boolean; displayedTenths: number; targetTenths: number }>,
): Extract<RatingGoalStatus, 'waiting_for_google' | 'holding' | 'dropped_below'> {
  if (input.waiting) return 'waiting_for_google'
  return input.displayedTenths >= input.targetTenths ? 'holding' : 'dropped_below'
}

/**
 * clamp((E − E0) / (θ − E0), 0, 1): how far the exact average has come from
 * the goal's baseline towards the threshold.
 */
export function ratingProgress(
  exact: Ratio,
  baselineExact: number,
  targetThresholdThousandths: number,
): number {
  const current = ratioToNumber(exact)
  const threshold = targetThresholdThousandths / 1000
  const span = threshold - baselineExact
  if (span <= 0) return current >= threshold ? 1 : 0
  return Math.min(1, Math.max(0, (current - baselineExact) / span))
}

export type NextTenthMilestone = Readonly<{
  targetTenths: number
  reviewsNeeded: ReviewsNeeded
}>

/** Reviews to the tenth above what Google shows, while it is not past the target. */
export function nextTenthMilestone(
  basis: RatingGoalBasis,
  targetTenths: number,
): NextTenthMilestone | null {
  const next = basis.displayedTenths + 1
  if (next > targetTenths) return null
  return {
    targetTenths: next,
    reviewsNeeded: reviewsNeeded({
      reviewCount: basis.reviewCount,
      exact: basis.exact,
      thresholdThousandths: thresholdThousandths(next),
      mix: basis.mix,
    }),
  }
}

/** The exact average has crossed the target's threshold; Google shows less. */
export function cacheShowsTargetFirst(
  exact: Ratio,
  displayedTenths: number,
  targetTenths: number,
): boolean {
  return (
    displayedTenths < targetTenths &&
    compareRatios(exact, fromThousandths(thresholdThousandths(targetTenths))) >= 0
  )
}
