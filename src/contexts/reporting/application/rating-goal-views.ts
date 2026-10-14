// Property Google rating goal — the views its reads return (pure).
//
// Builders from the domain values to the DTO types in dto/rating-goal.types.ts.
// No I/O: the use cases read, evaluate and pass the results here.

import {
  bestCaseReviewsNeeded,
  displayedTenths,
  ratio,
  ratioToNumber,
  reviewsNeeded,
  thresholdThousandths,
  type Ratio,
  type RecentMix,
  type ReviewsNeeded,
} from '../domain/rating-goal-numbers'
import { forecastArrival, type RatingForecast } from '../domain/rating-goal-forecast'
import {
  currentPacePerWeek,
  paceSuggestions,
  perDay,
  perMonth,
  type PaceSuggestions,
} from '../domain/rating-goal-pace'
import {
  offerKeepFirst,
  perfectStop,
  preselectedTarget,
  ratingStops,
  type RatingGoalBasis,
  type RatingStop,
} from '../domain/rating-goal-stops'
import {
  cacheShowsTargetFirst,
  forecastPaceBasis,
  nextTenthMilestone,
  ratingProgress,
} from '../domain/rating-goal-status'
import type {
  PropertyRatingGoal,
  RatingGoalChange,
  RatingGoalStatus,
} from '../domain/rating-goal'
import type {
  GoogleNumbersView,
  RatingGoalCardView,
  RatingGoalChangeView,
  RatingGoalForecastInputs,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
  RatingPaceView,
  RatingStopView,
  RecentMixView,
} from './dto/rating-goal.types'
import {
  ratingBasis,
  setupEligibility,
  type RatingGoalReading,
} from './rating-goal-reading'

const JUST_SET_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

export const tenthsToRating = (tenths: number): number => tenths / 10

const neededView = (needed: ReviewsNeeded): number | null =>
  needed === 'unreachable' ? null : needed

function googleView(reading: RatingGoalReading): GoogleNumbersView | null {
  const { google } = reading
  if (google === null) return null
  return {
    shows:
      google.displayedTenths === null ? null : tenthsToRating(google.displayedTenths),
    reviewCount: google.reviewCount,
    asOf: google.verifiedAt.toISOString(),
    current: reading.googleCurrent,
  }
}

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

const paceView = (perWeek: number): RatingPaceView => ({
  perWeek,
  perMonth: perMonth(perWeek),
  perDay: perDay(perWeek),
})

/** The forecast for one target at one weekly pace. */
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

function stopView(
  stop: RatingStop,
  basis: RatingGoalBasis,
  reading: RatingGoalReading,
  paces: PaceSuggestions,
): RatingStopView {
  const at = (perWeek: number) =>
    forecastFor(basis, reading, stop.targetTenths, ratio(perWeek, 1))
  return {
    targetTenths: stop.targetTenths,
    target: tenthsToRating(stop.targetTenths),
    reviewsNeeded: neededView(stop.reviewsNeeded),
    bestCase: neededView(stop.bestCase),
    label: stop.label,
    forecasts: {
      steady: at(paces.steady),
      faster: at(paces.faster),
      push: at(paces.push),
    },
  }
}

const ratioView = (value: Ratio) => ({ num: Number(value.num), den: Number(value.den) })

function forecastInputs(
  basis: RatingGoalBasis,
  reading: RatingGoalReading,
): RatingGoalForecastInputs {
  return {
    reviewCount: basis.reviewCount,
    exact: ratioView(basis.exact),
    mix: ratioView(basis.mix),
    reviewsLast28Days: reading.reviewsLast28Days,
    timezone: reading.facts.timezone,
    asOf: reading.now.toISOString(),
  }
}

/** Everything the setup wizard shows, worked out from one reading. */
export function buildSetupView(
  reading: RatingGoalReading,
  hasActiveGoal: boolean,
): RatingGoalSetupView {
  const paces = paceSuggestions(reading.reviewsLast28Days)
  const basis = ratingBasis(reading)
  const eligibility = setupEligibility(reading)
  const stops = basis ? ratingStops(basis, paces.faster) : []
  return {
    eligibility,
    hasActiveGoal,
    google: googleView(reading),
    ...exactView(reading),
    recentMix: mixView(reading.mix),
    currentPacePerWeek: round(
      ratioToNumber(currentPacePerWeek(reading.reviewsLast28Days)),
      2,
    ),
    paces: {
      steady: paceView(paces.steady),
      faster: paceView(paces.faster),
      push: paceView(paces.push),
    },
    stops: basis ? stops.map((stop) => stopView(stop, basis, reading, paces)) : [],
    perfectStop: basis ? perfectStop(basis.displayedTenths) : null,
    preselectedTenths: basis ? preselectedTarget(basis.displayedTenths, stops) : null,
    offerKeepFirst: basis ? offerKeepFirst(basis) : false,
    forecastInputs: basis ? forecastInputs(basis, reading) : null,
  }
}

/** The forecast the simple card shows: chosen pace for 28 days, then actual. */
function cardForecast(
  goal: PropertyRatingGoal,
  basis: RatingGoalBasis | null,
  reading: RatingGoalReading,
): Pick<RatingGoalCardView, 'forecast' | 'forecastBasis'> {
  if (goal.mode === 'keep' || basis === null || goal.pacePerWeek === null) {
    return { forecast: null, forecastBasis: null }
  }
  const actual = forecastPaceBasis(goal.createdAt, reading.now) === 'actual'
  const pace = actual
    ? currentPacePerWeek(reading.reviewsLast28Days)
    : ratio(goal.pacePerWeek, 1)
  return {
    forecast: forecastFor(basis, reading, goal.targetTenths, pace),
    forecastBasis: actual ? 'actual_pace' : 'chosen_pace',
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
  const basis = ratingBasis(reading)
  const threshold = thresholdThousandths(goal.targetTenths)
  return {
    goalId: goal.id,
    version: goal.version,
    state: goal.state,
    endedReason: goal.endedReason,
    mode: goal.mode,
    targetTenths: goal.targetTenths,
    target: tenthsToRating(goal.targetTenths),
    pacePerWeek: goal.pacePerWeek,
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
      goal.mode === 'climb' && basis !== null
        ? cacheShowsTargetFirst(basis.exact, basis.displayedTenths, goal.targetTenths)
        : false,
    thisWeekCount: counts.thisWeek,
    justSet: reading.now.getTime() - goal.createdAt.getTime() < JUST_SET_DAYS * DAY_MS,
    ...cardForecast(goal, basis, reading),
    setAt: goal.createdAt.toISOString(),
  }
}

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

export const historyEntry = (goal: PropertyRatingGoal): RatingGoalHistoryEntry => ({
  goalId: goal.id,
  mode: goal.mode,
  targetTenths: goal.targetTenths,
  target: tenthsToRating(goal.targetTenths),
  pacePerWeek: goal.pacePerWeek,
  state: goal.state === 'reached' ? 'reached' : 'ended',
  endedReason: goal.endedReason,
  setAt: goal.createdAt.toISOString(),
  setBy: goal.createdBy,
  reachedAt: goal.reachedAt?.toISOString() ?? null,
  endedAt: goal.endedAt?.toISOString() ?? null,
  baselineGoogleShows: tenthsToRating(displayedTenths(goal.baseline.googleAverage)),
})
