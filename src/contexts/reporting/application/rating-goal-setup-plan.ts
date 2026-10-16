// Property Google rating goal — the one-screen setup, worked out (pure, client-safe).
//
// Rounds 3 and 4 (2026-10-16, PLAN-R4 B.1): the setup opens already answered and
// answers every change on the page with no server call. `workOutRatingGoal`
// turns the setup read's exact inputs and what the manager chose into the
// screen: the planned average (automatic, typed, or the plan's earlier one),
// the pace chips and the pace, the goal (the recommendation unless − / + pinned
// another), what it needs, when, the likely range, the next goal up, the
// faster chip when it is more than six months away, and the average it ends
// at. It never throws on what a manager typed or on a draft the inputs moved
// under (D20): out-of-range values are clamped and reported.
//
// Components import the Reporting values they need from here, never from the
// domain (D29, the components boundary in eslint.config.js).

import {
  automaticAverage,
  bestEvidence,
  goalRange,
  ownAverageFloor,
  reachableAt,
} from '../domain/rating-goal-average'
import {
  daysAt,
  earnedTenths,
  fasterPaceChip,
  likelyDays,
  recommendedGoal,
  SIX_MONTHS_DAYS,
  withinDays,
} from '../domain/rating-goal-duration'
import { ratio, type Ratio } from '../domain/rating-goal-numbers'
import {
  MAX_PACE_TENTHS_PER_WEEK,
  MIN_PACE_TENTHS_PER_WEEK,
} from '../domain/rating-goal-pace'
import { nowPerMonth, paceChips, type PaceChips } from '../domain/rating-goal-pace-chips'
import { nearestTenth } from '../domain/rating-goal-quality'
import {
  HIGHEST_TARGET_TENTHS,
  PERFECT_TENTHS,
  type RatingGoalNumbers,
  planNeeds,
} from '../domain/rating-goal-stops'
import type {
  RatingFraction,
  RatingGoalSetupChoices,
  RatingGoalSetupInputs,
  RatingGoalSetupPlanView,
  RatingSetupAverageView,
  RatingSetupGoalView,
  RatingSetupPaceView,
} from './dto/rating-goal-setup.types'

export {
  OWN_PACE_MIN_TENTHS,
  dayTenthsOf,
  ownPaceTenths,
  perMonthOf,
} from '../domain/rating-goal-pace-chips'
/** The planned average counts like this many reviews as real ones arrive (X3). */
export { PLANNED_AVERAGE_WEIGHT_REVIEWS } from '../domain/rating-goal-status'
export { ownAverageTenths } from '../domain/rating-goal-average'
export {
  HIGHEST_TARGET_TENTHS,
  KEEP_FIRST_FROM_TENTHS,
} from '../domain/rating-goal-stops'

type Plan = Extract<RatingGoalSetupPlanView, { kind: 'plan' }>

/** Nothing chosen: the screen as recommended. */
export const NO_SETUP_CHOICES: RatingGoalSetupChoices = {
  pace: null,
  ownAverageTenths: null,
  keptAverageTenths: null,
  pinnedTargetTenths: null,
}

const fractionOf = (value: Readonly<{ num: number; den: number }>): Ratio =>
  ratio(value.num, value.den)

const numbersOf = (inputs: RatingGoalSetupInputs): RatingGoalNumbers => ({
  reviewCount: inputs.reviewCount,
  displayedTenths: inputs.displayedTenths,
  exact: fractionOf(inputs.exact),
})

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

/** The average the plan assumes: typed, kept from the plan, or automatic. */
function averageOf(
  inputs: RatingGoalSetupInputs,
  choices: RatingGoalSetupChoices,
  earned: number,
): RatingSetupAverageView {
  const { bestMonth, bestYear } = inputs
  const evidence = bestEvidence(
    bestMonth === null ? null : { ...bestMonth, average: fractionOf(bestMonth.average) },
    bestYear === null ? null : { ...bestYear, average: fractionOf(bestYear.average) },
  )
  const shown = inputs.displayedTenths
  const automatic = automaticAverage(shown, evidence)
  const ownMinTenths = ownAverageFloor(Math.max(shown, earned))
  const ownOnly = !reachableAt(shown, Math.max(shown, earned) + 1, automatic.tenths)
  const base = { automaticTenths: automatic.tenths, evidence, ownMinTenths, ownOnly }
  const typed = choices.ownAverageTenths ?? choices.keptAverageTenths
  if (typed !== null) {
    const tenths = clamp(typed, ownMinTenths, PERFECT_TENTHS)
    const source = choices.ownAverageTenths === null ? 'earlier' : 'own'
    return { ...base, tenths, source, clamped: tenths !== typed }
  }
  if (ownOnly) {
    return { ...base, tenths: ownMinTenths, source: 'needs_own', clamped: false }
  }
  return { ...base, tenths: automatic.tenths, source: automatic.source, clamped: false }
}

/** The pace: a chip, the manager's own, or the recommended chip. */
function paceOf(
  chips: PaceChips,
  choices: RatingGoalSetupChoices,
  reviewsLast90Days: number,
): RatingSetupPaceView {
  const pick = (index: number | null, tenthsPerWeek: number, clamped: boolean) => ({
    tenthsPerWeek,
    chips: chips.chips,
    recommendedIndex: chips.recommendedIndex,
    chosenIndex: index,
    busiest30: chips.busiest30,
    provenDayTenths: nearestTenth(chips.provenPerDay),
    nowPerMonth: nowPerMonth(reviewsLast90Days),
    clamped,
  })
  const choice = choices.pace
  if (choice?.kind === 'own') {
    const tenths = clamp(
      choice.tenthsPerWeek,
      MIN_PACE_TENTHS_PER_WEEK,
      MAX_PACE_TENTHS_PER_WEEK,
    )
    return pick(null, tenths, tenths !== choice.tenthsPerWeek)
  }
  const wanted = choice?.kind === 'chip' ? choice.index : chips.recommendedIndex
  const index = clamp(Math.trunc(wanted), 0, chips.chips.length - 1)
  const chip = chips.chips[index]
  return pick(index, chip?.tenthsPerWeek ?? MIN_PACE_TENTHS_PER_WEEK, index !== wanted)
}

/** The goal shown: the recommendation, or the pin within the range. */
function goalOf(
  numbers: RatingGoalNumbers,
  earned: number,
  qualityTenths: number,
  tenthsPerWeek: number,
  pin: number | null,
): RatingSetupGoalView {
  const shown = numbers.displayedTenths
  const { minTenths, maxTenths } = goalRange(shown, earned, qualityTenths)
  const recommended = recommendedGoal(numbers, minTenths, qualityTenths, tenthsPerWeek)
  const targetTenths = clamp(pin ?? recommended.targetTenths, minTenths, maxTenths)
  const pinnedAboveMax = pin !== null && pin > maxTenths
  const following =
    pin === null || (!pinnedAboveMax && targetTenths === recommended.targetTenths)
  return {
    shownTenths: shown,
    earnedTenths: earned,
    minTenths,
    maxTenths,
    targetTenths,
    recommendedTenths: recommended.targetTenths,
    recommendedIsSafe: recommended.safe,
    pinnedTenths: following ? null : pinnedAboveMax ? pin : targetTenths,
    pinnedAboveMax,
  }
}

/** Reviews a goal needs at an average; a goal in range always needs some (D28). */
function needed(
  numbers: RatingGoalNumbers,
  targetTenths: number,
  qualityTenths: number,
): number {
  const reviews = planNeeds(numbers, targetTenths, qualityTenths).reviewsNeeded
  if (reviews === 'unreachable' || reviews <= 0) {
    throw new RangeError(
      `A goal in range needs reviews: ${targetTenths} at ${qualityTenths}`,
    )
  }
  return reviews
}

/** (E·N + n·q/10) / (N + n) in hundredths, half up. */
function averageAfter(
  inputs: RatingGoalSetupInputs,
  reviews: number,
  qualityTenths: number,
): number {
  const exact = fractionOf(inputs.exact)
  const num =
    exact.num * BigInt(inputs.reviewCount) * 10n +
    BigInt(reviews * qualityTenths) * exact.den
  const den = exact.den * 10n * BigInt(inputs.reviewCount + reviews)
  return Number((200n * num + den) / (2n * den))
}

/** What the goal needs, when, and what is around it. */
function outlookOf(
  inputs: RatingGoalSetupInputs,
  numbers: RatingGoalNumbers,
  plan: Pick<Plan, 'average' | 'pace' | 'goal'>,
): Omit<Plan, 'kind' | 'average' | 'pace' | 'goal'> {
  const q = plan.average.tenths
  const p = plan.pace.tenthsPerWeek
  const { targetTenths, recommendedTenths } = plan.goal
  const reviews = needed(numbers, targetTenths, q)
  const next = recommendedTenths + 1
  const nextReviews = reachableAt(numbers.displayedTenths, next, q)
    ? needed(numbers, next, q)
    : null
  const faster = fasterPaceChip(reviews, p, plan.pace.chips)
  const fasterChip = faster === null ? undefined : plan.pace.chips[faster]
  return {
    reviewsNeeded: reviews,
    days: daysAt(reviews, p),
    likely: likelyDays(numbers, targetTenths, q, p),
    overSixMonths: !withinDays(reviews, p, SIX_MONTHS_DAYS),
    nextUp:
      nextReviews === null
        ? null
        : {
            targetTenths: next,
            reviewsNeeded: nextReviews,
            days: daysAt(nextReviews, p),
          },
    fasterPace:
      faster === null || fasterChip === undefined
        ? null
        : { chipIndex: faster, days: daysAt(reviews, fasterChip.tenthsPerWeek) },
    averageAfterHundredths: averageAfter(inputs, reviews, q),
    daysAtTodaysPace: todaysPace(reviews, inputs.reviewsLast90Days),
  }
}

const DAYS_IN_LAST = 90

/** The same reviews at the last 90 days' pace, as days. */
const todaysPace = (reviews: number, reviewsLast90Days: number): RatingFraction | null =>
  reviewsLast90Days === 0 ? null : { num: reviews * DAYS_IN_LAST, den: reviewsLast90Days }

/** The setup screen for these inputs and these choices. */
export function workOutRatingGoal(
  inputs: RatingGoalSetupInputs,
  choices: RatingGoalSetupChoices,
): RatingGoalSetupPlanView {
  if (inputs.displayedTenths >= HIGHEST_TARGET_TENTHS) return { kind: 'keep_only' }
  const numbers = numbersOf(inputs)
  const earned = earnedTenths(numbers)
  if (earned >= HIGHEST_TARGET_TENTHS)
    return { kind: 'catching_up', earnedTenths: earned }
  const average = averageOf(inputs, choices, earned)
  const chips = paceChips(inputs.reviewsLast90Days, inputs.busiest30Days)
  const pace = paceOf(chips, choices, inputs.reviewsLast90Days)
  const goal = goalOf(
    numbers,
    earned,
    average.tenths,
    pace.tenthsPerWeek,
    choices.pinnedTargetTenths,
  )
  return {
    kind: 'plan',
    average,
    pace,
    goal,
    ...outlookOf(inputs, numbers, { average, pace, goal }),
  }
}
