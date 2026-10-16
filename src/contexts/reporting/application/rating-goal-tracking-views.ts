// Property Google rating goal — what the card says about the climb (pure).
//
// Round 5 (2026-10-16, PLAN-D D-1): the card counts to the next number Google
// can show (E5), names the number above the goal as possible (R4-4), says when
// the goal arrives in durations from today with the setup's one rule (E1), and
// carries this week's day and the last four weeks' pace, all worked out here
// inside the one card read (E8): no new query.
//
// The arrival keeps Q8's basis (E4): the chosen pace until the goal is 28 days
// old, then the reviews of the last 28 days, and the sentence names which.

import {
  actualRate,
  arrivalDays,
  chosenRate,
  nextNumber,
  nextUpAbove,
  type Arrival,
  type PaceRate,
} from '../domain/rating-goal-arrival'
import {
  displayedTenths,
  ratioToNumber,
  reviewsNeeded,
  thresholdThousandths,
} from '../domain/rating-goal-numbers'
import { currentPacePerWeek } from '../domain/rating-goal-pace'
import { forecastPaceBasis } from '../domain/rating-goal-status'
import type { RatingGoalBasis } from '../domain/rating-goal-stops'
import { propertyWeekday } from '../domain/rating-goal-weeks'
import type { PropertyRatingGoal } from '../domain/rating-goal'
import type { RatingArrivalView, RatingGoalCardView } from './dto/rating-goal.types'
import type { RatingGoalReading } from './rating-goal-reading'

export const tenthsToRating = (tenths: number): number => tenths / 10

const round = (value: number, decimals: number): number => {
  const scale = 10 ** decimals
  return Math.round(value * scale) / scale
}

/** An arrival as the DTO carries it: the same exact fractions. */
export function arrivalView(arrival: Arrival): RatingArrivalView {
  if (arrival.kind !== 'days') return { kind: arrival.kind }
  return {
    kind: 'days',
    central: arrival.central,
    fast: arrival.fast,
    slow: arrival.slow,
  }
}

/** When one target arrives at the basis's average and a pace. */
export const forecastFor = (
  basis: RatingGoalBasis,
  targetTenths: number,
  rate: PaceRate,
): RatingArrivalView => arrivalView(arrivalDays(basis, targetTenths, basis.mix, rate))

export type CardRate = Readonly<{
  rate: PaceRate
  basis: NonNullable<RatingGoalCardView['forecastBasis']>
}>

/** The pace the card works with (Q8): chosen for 28 days, then the last 28 days'. */
export function cardRate(
  goal: PropertyRatingGoal,
  reading: Pick<RatingGoalReading, 'now' | 'reviewsLast28Days'>,
): CardRate | null {
  if (goal.paceTenthsPerWeek === null) return null
  return forecastPaceBasis(goal.createdAt, reading.now) === 'actual'
    ? { rate: actualRate(reading.reviewsLast28Days), basis: 'actual_pace' }
    : { rate: chosenRate(goal.paceTenthsPerWeek), basis: 'chosen_pace' }
}

type Tracking = Pick<
  RatingGoalCardView,
  | 'next'
  | 'earnedTenths'
  | 'stillNeeded'
  | 'lastFourWeeksPerWeek'
  | 'baseline'
  | 'nextUp'
  | 'weekday'
>

const neededAt = (basis: RatingGoalBasis, targetTenths: number): number | null => {
  const needed = reviewsNeeded({
    reviewCount: basis.reviewCount,
    exact: basis.exact,
    thresholdThousandths: thresholdThousandths(targetTenths),
    mix: basis.mix,
  })
  return needed === 'unreachable' ? null : needed
}

/** The headline's number and the tenth Google should show soon (E5). */
function nextView(
  basis: RatingGoalBasis,
  targetTenths: number,
): Pick<Tracking, 'next' | 'earnedTenths'> {
  const next = nextNumber(basis, targetTenths)
  if (next === null) return { next: null, earnedTenths: null }
  const needed = neededAt(basis, next.targetTenths)
  return {
    next:
      needed === null
        ? null
        : {
            targetTenths: next.targetTenths,
            target: tenthsToRating(next.targetTenths),
            reviewsNeeded: needed,
          },
    earnedTenths: next.soonTenths,
  }
}

function nextUpView(
  basis: RatingGoalBasis,
  targetTenths: number,
  rate: CardRate | null,
): Tracking['nextUp'] {
  const up = rate === null ? null : nextUpAbove(basis, targetTenths, basis.mix, rate.rate)
  return up === null
    ? null
    : { targetTenths: up.targetTenths, reviewsBeyondGoal: up.beyond, days: up.days }
}

export const baselineView = (goal: PropertyRatingGoal): Tracking['baseline'] => ({
  googleShows: tenthsToRating(displayedTenths(goal.baseline.googleAverage)),
  reviewCount: goal.baseline.reviewCount,
  exactAverage: round(goal.baseline.exactAverage, 3),
})

/**
 * The card's climb: the next number, what is still needed, the number above the
 * goal, the day of the week and the last four weeks. `basis` is the goal's
 * numbers at its tracking average, null for a keep goal or without numbers.
 */
export function cardTracking(
  goal: PropertyRatingGoal,
  reading: RatingGoalReading,
  basis: RatingGoalBasis | null,
): Tracking {
  const common = {
    lastFourWeeksPerWeek: round(
      ratioToNumber(currentPacePerWeek(reading.reviewsLast28Days)),
      2,
    ),
    baseline: baselineView(goal),
    weekday: propertyWeekday(reading.now, reading.facts.timezone),
  }
  if (goal.mode === 'keep' || basis === null) {
    return { ...common, next: null, earnedTenths: null, stillNeeded: null, nextUp: null }
  }
  return {
    ...common,
    ...nextView(basis, goal.targetTenths),
    stillNeeded: neededAt(basis, goal.targetTenths),
    nextUp: nextUpView(basis, goal.targetTenths, cardRate(goal, reading)),
  }
}
