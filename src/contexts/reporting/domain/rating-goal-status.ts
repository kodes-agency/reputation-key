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
// their stars. The goal's numbers assume its planned quality blended with the
// reviews since the set from the first one, the plan counted as 15 reviews
// (round 4, X3). Before the tenth they never assume less than the least a plan
// for the target may assume (minimumQualityTenths, or the plan if it is lower):
// below it a blend could read "not reachable", a verdict R2-5 holds to ten.
// While those reviews are too low, their own average (trackingMix).

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
import { minimumQualityTenths } from './rating-goal-quality'
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
/** New reviews are judged on their own average from this many since the set (R2-5). */
export const QUALITY_VERDICT_MIN_REVIEWS = 10
/**
 * The planned average counts like this many reviews in the average a goal's
 * numbers assume, so new reviews take over step by step (R4-2, owner X3).
 */
export const PLANNED_AVERAGE_WEIGHT_REVIEWS = 15

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

/**
 * reviews / weeks(window) ≥ 90% × chosen, with the chosen pace in tenths a
 * week. Compared in BigInt: as Numbers the products pass 2^53 above about
 * 14,900 reviews in the window, where a comparison could silently round.
 */
function isOnPace(
  reviews: number,
  window: PaceWindow,
  chosenTenthsPerWeek: number,
): boolean {
  const windowMs = BigInt(window.end.getTime() - window.start.getTime())
  return (
    BigInt(reviews) * BigInt(WEEK_MS) * 1000n >=
    BigInt(ON_PACE_PERCENT) * BigInt(chosenTenthsPerWeek) * windowMs
  )
}

/**
 * Which average a goal's numbers assume: `planned` while no review arrived
 * since the set, or before the tenth while the blend is held at a floor that is
 * the plan itself (a plan at the target's minimum quality); `blended` from the
 * first review otherwise (the plan counted as PLANNED_AVERAGE_WEIGHT_REVIEWS
 * reviews beside them, held at the target's minimum quality before the tenth);
 * and `since_set` while they are too low for the target, so the numbers say
 * what the status says.
 */
export type QualityBasis = 'planned' | 'blended' | 'since_set'

export type TrackingMix = Readonly<{ mix: Ratio; basis: QualityBasis }>

/**
 * The stars new reviews are expected to average (round 4, X3): the plan's
 * tenths q blended with the n reviews since the set and their star sum s,
 * (W × q / 10 + s) / (W + n), exact. Too low for the target, their own
 * average (s / n) instead: the verdict judges them unblended (`reviewsTooLow`).
 * Before the tenth review the blend is held at min(q, minimumQualityTenths(T)):
 * lower, it could read "not reachable" under a chip that is not too low (R2-5).
 * From the tenth on no floor is needed: a blend of the plan with reviews that
 * clear the threshold clears it too.
 */
export function trackingMix(
  plannedQualityTenths: number,
  sinceSet: RatingTotals,
  targetTenths: number,
): TrackingMix {
  if (reviewsTooLow(sinceSet, targetTenths)) {
    return { mix: ratio(sinceSet.sum, sinceSet.count), basis: 'since_set' }
  }
  if (sinceSet.count === 0) {
    return { mix: ratio(plannedQualityTenths, 10), basis: 'planned' }
  }
  const blend = blendedMix(plannedQualityTenths, sinceSet)
  if (sinceSet.count >= QUALITY_VERDICT_MIN_REVIEWS)
    return { mix: blend, basis: 'blended' }
  const floorTenths = Math.min(plannedQualityTenths, minimumQualityTenths(targetTenths))
  if (compareRatios(blend, ratio(floorTenths, 10)) >= 0) {
    return { mix: blend, basis: 'blended' }
  }
  const basis = floorTenths === plannedQualityTenths ? 'planned' : 'blended'
  return { mix: ratio(floorTenths, 10), basis }
}

/** (W × q / 10 + s) / (W + n), exact. */
function blendedMix(plannedQualityTenths: number, sinceSet: RatingTotals): Ratio {
  const weight = PLANNED_AVERAGE_WEIGHT_REVIEWS
  return ratio(
    weight * plannedQualityTenths + 10 * sinceSet.sum,
    10 * (weight + sinceSet.count),
  )
}

/** Above the target's threshold: the average that makes Google show it. */
function clearsThreshold(average: Ratio, targetTenths: number): boolean {
  const threshold = fromThousandths(thresholdThousandths(targetTenths))
  return compareRatios(average, threshold) > 0
}

/** Ten or more reviews since the set average at or below the target's threshold. */
export function reviewsTooLow(sinceSet: RatingTotals, targetTenths: number): boolean {
  if (sinceSet.count < QUALITY_VERDICT_MIN_REVIEWS) return false
  return !clearsThreshold(ratio(sinceSet.sum, sinceSet.count), targetTenths)
}

export type ClimbStatusInput = Readonly<{
  waiting: boolean
  displayedTenths: number
  targetTenths: number
  /** Reviews created since the goal was set, and their stars. */
  sinceSet: RatingTotals
  goalCreatedAt: Date
  now: Date
  /** The goal's pace in tenths of a review a week. */
  chosenTenthsPerWeek: number
  /** Reviews created in `statusPaceWindow`; null while there is none. */
  reviewsInPaceWindow: number | null
}>

export function climbStatus(input: ClimbStatusInput): RatingGoalStatus {
  if (input.waiting) return 'waiting_for_google'
  if (input.displayedTenths >= input.targetTenths) return 'reached'
  if (reviewsTooLow(input.sinceSet, input.targetTenths)) return 'reviews_too_low'
  const window = statusPaceWindow(input.goalCreatedAt, input.now)
  if (window === null || input.reviewsInPaceWindow === null) return 'getting_started'
  return isOnPace(input.reviewsInPaceWindow, window, input.chosenTenthsPerWeek)
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
