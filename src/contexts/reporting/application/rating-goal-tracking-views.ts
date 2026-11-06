// Build card tracking from the existing read using the shared setup arrival rule.
// Use chosen pace until it is 28 days old, then actual reviews over the last 28
// days, and name that basis. Count toward the next unearned Google tenth.

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
function arrivalView(arrival: Arrival): RatingArrivalView {
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
  return forecastPaceBasis(goal.paceSince, reading.now) === 'actual'
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

const baselineView = (goal: PropertyRatingGoal): Tracking['baseline'] => ({
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
