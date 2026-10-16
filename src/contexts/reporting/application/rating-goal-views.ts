// Property Google rating goal — the views its reads return (pure).
//
// Builders from the domain values to the DTO types in dto/rating-goal.types.ts.
// No I/O: the use cases read, evaluate and pass the results here. The setup
// view carries the exact inputs the page works its plan out from
// (rating-goal-setup-plan.ts); no planning maths runs here (PLAN-R4 D18).
//
// A goal's own numbers (its forecast, what it still needs, the next tenth)
// assume the quality the goal now expects of new reviews: its planned quality
// until ten reviews arrived since it was set, then their average (round 2).

import {
  bestCaseReviewsNeeded,
  displayedTenths,
  ratio,
  ratioToNumber,
  reviewsNeeded,
  thresholdThousandths,
  type Ratio,
  type RatingTotals,
  type RecentMix,
  type ReviewsNeeded,
} from '../domain/rating-goal-numbers'
import { forecastArrival, type RatingForecast } from '../domain/rating-goal-forecast'
import { googleNumbersView } from '../domain/google-numbers'
import { currentPacePerWeek, paceRatio } from '../domain/rating-goal-pace'
import { bestYear, nearestTenth, type YearTotals } from '../domain/rating-goal-quality'
import {
  bestMonth,
  busiestWindowCount,
  type DayCount,
  type MonthTotals,
} from '../domain/rating-goal-evidence'
import {
  cacheShowsTargetFirst,
  forecastPaceBasis,
  nextTenthMilestone,
  ratingProgress,
  trackingMix,
  type QualityBasis,
} from '../domain/rating-goal-status'
import {
  HIGHEST_TARGET_TENTHS,
  offerKeepFirst,
  type RatingGoalBasis,
} from '../domain/rating-goal-stops'
import type {
  PropertyRatingGoal,
  RatingGoalChange,
  RatingGoalStatus,
} from '../domain/rating-goal'
import type {
  GoogleNumbersView,
  RatingGoalCardView,
  RatingGoalChangeView,
  RatingGoalHistoryEntry,
  RatingGoalPlanProgressView,
  RatingGoalSetupView,
  RecentMixView,
} from './dto/rating-goal.types'
import type { RatingGoalSetupInputs } from './dto/rating-goal-setup.types'
import {
  ratingBasis,
  setupEligibility,
  type RatingGoalReading,
} from './rating-goal-reading'

const JUST_SET_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
const NO_REVIEWS: RatingTotals = { count: 0, sum: 0 }

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

export const tenthsToRating = (tenths: number): number => tenths / 10

const neededView = (needed: ReviewsNeeded): number | null =>
  needed === 'unreachable' ? null : needed

const googleView = (reading: RatingGoalReading): GoogleNumbersView | null =>
  googleNumbersView(reading.google, reading.facts.googleBindingActive, reading.now)

/** The exact average to three decimals and where it comes from, or neither. */
function exactView(
  reading: RatingGoalReading,
): Pick<RatingGoalCardView, 'exactAverage' | 'exactAverageSource'> {
  const { exact } = reading
  return exact === null
    ? { exactAverage: null, exactAverageSource: null }
    : {
        exactAverage: round(ratioToNumber(exact.value), 3),
        exactAverageSource: exact.source,
      }
}

export const mixView = (mix: RecentMix | null): RecentMixView | null =>
  mix === null
    ? null
    : {
        average: round(ratioToNumber(mix.value), 3),
        reviewCount: mix.reviewCount,
        basis: mix.basis,
      }

/** The forecast for one target at one weekly pace, at the basis's mix. */
export function forecastFor(
  basis: RatingGoalBasis,
  reading: Pick<RatingGoalReading, 'now' | 'facts'>,
  targetTenths: number,
  pacePerWeek: Ratio,
): RatingForecast {
  return forecastArrival({
    reviewCount: basis.reviewCount,
    exact: basis.exact,
    thresholdThousandths: thresholdThousandths(targetTenths),
    mix: basis.mix,
    pacePerWeek,
    now: reading.now,
    timezone: reading.facts.timezone,
  })
}

const ratioView = (value: Ratio) => ({ num: Number(value.num), den: Number(value.den) })

/** The setup's evidence, read from the review cache beside the reading. */
type SetupEvidence = Readonly<{
  years: readonly YearTotals[]
  months: readonly MonthTotals[]
  days: readonly DayCount[]
}>

/**
 * What the one-screen setup works its plan out from, or null while Google's
 * numbers are waiting or show no tenth. No planning maths runs here.
 */
function setupInputsOf(
  reading: RatingGoalReading,
  evidence: SetupEvidence,
): RatingGoalSetupInputs | null {
  const { google, exact } = reading
  if (reading.waiting || google?.displayedTenths == null || exact === null) return null
  const { timezone } = reading.facts
  const month = bestMonth(evidence.months, reading.now, timezone)
  const year = bestYear(evidence.years)
  return {
    reviewCount: google.reviewCount,
    displayedTenths: google.displayedTenths,
    exact: ratioView(exact.value),
    exactSource: exact.source,
    bestMonth:
      month === null
        ? null
        : {
            year: month.year,
            month: month.month,
            average: ratioView(month.average),
            reviewCount: month.reviewCount,
          },
    bestYear:
      year === null
        ? null
        : {
            year: year.year,
            average: ratioView(year.average),
            reviewCount: year.reviewCount,
          },
    reviewsLast90Days: reading.reviewsLast90Days,
    busiest30Days: busiestWindowCount(evidence.days, reading.now, timezone),
    timezone,
    asOf: reading.now.toISOString(),
  }
}

/**
 * Everything the setup shows: whether a goal may be set, Google's numbers, and
 * the exact inputs the one-screen setup works its plan out from. `offersClimb`
 * says whether a climb can be planned, with no planning maths.
 */
export function buildSetupView(
  reading: RatingGoalReading,
  hasActiveGoal: boolean,
  evidence: SetupEvidence,
): RatingGoalSetupView {
  const eligibility = setupEligibility(reading)
  const setupInputs = setupInputsOf(reading, evidence)
  const basis = ratingBasis(reading)
  return {
    eligibility,
    hasActiveGoal,
    google: googleView(reading),
    ...exactView(reading),
    offerKeepFirst: basis !== null && offerKeepFirst(basis.displayedTenths),
    setupInputs,
    offersClimb:
      eligibility.eligible &&
      setupInputs !== null &&
      setupInputs.displayedTenths < HIGHEST_TARGET_TENTHS,
  }
}

export type GoalBasis = Readonly<{ basis: RatingGoalBasis; qualityBasis: QualityBasis }>

/**
 * A climb goal's numbers at the quality it now expects of new reviews, or null
 * for a keep goal or without Google's numbers.
 */
export function goalBasis(
  goal: PropertyRatingGoal,
  reading: RatingGoalReading,
): GoalBasis | null {
  const numbers = ratingBasis(reading)
  if (goal.mode === 'keep' || numbers === null || goal.qualityTenths === null) return null
  const tracking = trackingMix(goal.qualityTenths, reading.sinceSet ?? NO_REVIEWS)
  return { basis: { ...numbers, mix: tracking.mix }, qualityBasis: tracking.basis }
}

/** The forecast the simple card shows: chosen pace for 28 days, then actual. */
function cardForecast(
  goal: PropertyRatingGoal,
  numbers: GoalBasis | null,
  reading: RatingGoalReading,
): Pick<RatingGoalCardView, 'forecast' | 'forecastBasis' | 'qualityBasis'> {
  if (numbers === null || goal.paceTenthsPerWeek === null) {
    return { forecast: null, forecastBasis: null, qualityBasis: null }
  }
  const actual = forecastPaceBasis(goal.createdAt, reading.now) === 'actual'
  const pace = actual
    ? currentPacePerWeek(reading.reviewsLast28Days)
    : paceRatio(goal.paceTenthsPerWeek)
  return {
    forecast: forecastFor(numbers.basis, reading, goal.targetTenths, pace),
    forecastBasis: actual ? 'actual_pace' : 'chosen_pace',
    qualityBasis: numbers.qualityBasis,
  }
}

export type CardCounts = Readonly<{ thisWeek: number }>

/** The simple card: Google's number, the target, progress, pace line and forecast. */
export function buildCardView(
  goal: PropertyRatingGoal,
  status: RatingGoalStatus,
  reading: RatingGoalReading,
  counts: CardCounts,
): RatingGoalCardView {
  const numbers = goalBasis(goal, reading)
  const threshold = thresholdThousandths(goal.targetTenths)
  return {
    goalId: goal.id,
    version: goal.version,
    state: goal.state,
    endedReason: goal.endedReason,
    mode: goal.mode,
    targetTenths: goal.targetTenths,
    target: tenthsToRating(goal.targetTenths),
    qualityTenths: goal.qualityTenths,
    quality: goal.qualityTenths === null ? null : tenthsToRating(goal.qualityTenths),
    paceTenthsPerWeek: goal.paceTenthsPerWeek,
    status,
    google: googleView(reading),
    ...exactView(reading),
    threshold: threshold / 1000,
    progress:
      goal.mode === 'climb' && reading.exact
        ? round(
            ratingProgress(reading.exact.value, goal.baseline.exactAverage, threshold),
            3,
          )
        : null,
    googleShowsSoon:
      numbers !== null &&
      cacheShowsTargetFirst(
        numbers.basis.exact,
        numbers.basis.displayedTenths,
        goal.targetTenths,
      ),
    thisWeekCount: counts.thisWeek,
    justSet: reading.now.getTime() - goal.createdAt.getTime() < JUST_SET_DAYS * DAY_MS,
    ...cardForecast(goal, numbers, reading),
    setAt: goal.createdAt.toISOString(),
  }
}

/** One change as logged: a pace in tenths of a review a week, a target or average in tenths. */
export const changeView = (change: RatingGoalChange): RatingGoalChangeView => ({
  changedBy: change.changedBy,
  changedAt: change.changedAt.toISOString(),
  field: change.field,
  oldValue: change.oldValue,
  newValue: change.newValue,
})

/** Still needed and its best case at the goal's target, or nothing for keep. */
export function stillNeeded(
  goal: PropertyRatingGoal,
  basis: RatingGoalBasis | null,
): Readonly<{ stillNeeded: number | null; bestCase: number | null }> {
  if (goal.mode === 'keep' || basis === null) return { stillNeeded: null, bestCase: null }
  const plan = {
    reviewCount: basis.reviewCount,
    exact: basis.exact,
    thresholdThousandths: thresholdThousandths(goal.targetTenths),
  }
  return {
    stillNeeded: neededView(reviewsNeeded({ ...plan, mix: basis.mix })),
    bestCase: neededView(bestCaseReviewsNeeded(plan)),
  }
}

export function nextTenthView(goal: PropertyRatingGoal, basis: RatingGoalBasis | null) {
  if (goal.mode === 'keep' || basis === null) return null
  const next = nextTenthMilestone(basis, goal.targetTenths)
  return next === null
    ? null
    : {
        targetTenths: next.targetTenths,
        target: tenthsToRating(next.targetTenths),
        reviewsNeeded: neededView(next.reviewsNeeded),
      }
}

/** The reviews since the set: their count, and their average once there are ten. */
function sinceSetView(
  sinceSet: RatingTotals,
  qualityBasis: QualityBasis,
): RatingGoalPlanProgressView['sinceSet'] {
  if (qualityBasis === 'planned' || sinceSet.count === 0) {
    return { reviewCount: sinceSet.count, average: null, averageTenths: null }
  }
  const average = ratio(sinceSet.sum, sinceSet.count)
  return {
    reviewCount: sinceSet.count,
    average: round(ratioToNumber(average), 3),
    averageTenths: nearestTenth(average),
  }
}

/** "Your plan": the plan beside what happened since it was set, then the forecast. */
export function planProgressView(
  goal: PropertyRatingGoal,
  reading: RatingGoalReading,
): RatingGoalPlanProgressView | null {
  const numbers = goalBasis(goal, reading)
  if (
    numbers === null ||
    goal.qualityTenths === null ||
    goal.paceTenthsPerWeek === null
  ) {
    return null
  }
  const actualPace = currentPacePerWeek(reading.reviewsLast28Days)
  return {
    targetTenths: goal.targetTenths,
    googleShowsTenths: reading.google?.displayedTenths ?? null,
    qualityTenths: goal.qualityTenths,
    sinceSet: sinceSetView(reading.sinceSet ?? NO_REVIEWS, numbers.qualityBasis),
    qualityBasis: numbers.qualityBasis,
    paceTenthsPerWeek: goal.paceTenthsPerWeek,
    lastFourWeeksPerWeek: round(ratioToNumber(actualPace), 2),
    forecast: forecastFor(numbers.basis, reading, goal.targetTenths, actualPace),
  }
}

export const historyEntry = (goal: PropertyRatingGoal): RatingGoalHistoryEntry => ({
  goalId: goal.id,
  mode: goal.mode,
  targetTenths: goal.targetTenths,
  target: tenthsToRating(goal.targetTenths),
  qualityTenths: goal.qualityTenths,
  paceTenthsPerWeek: goal.paceTenthsPerWeek,
  state: goal.state === 'reached' ? 'reached' : 'ended',
  endedReason: goal.endedReason,
  setAt: goal.createdAt.toISOString(),
  setBy: goal.createdBy,
  reachedAt: goal.reachedAt?.toISOString() ?? null,
  endedAt: goal.endedAt?.toISOString() ?? null,
  baselineGoogleShows: tenthsToRating(displayedTenths(goal.baseline.googleAverage)),
})
