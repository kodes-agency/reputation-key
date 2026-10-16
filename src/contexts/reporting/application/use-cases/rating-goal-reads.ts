// Property Google rating goal — the reads: setup, simple card, detail, history.
//
// The setup read also asks Review for each calendar year's totals: the best
// year is evidence for the plans' quality ("Like your best year").
//
// The card and the detail evaluate the active goal as they read it, through
// the same evaluation the snapshot consumer runs, so a goal Google now shows
// the target of is reached (and one whose Property was archived or whose
// Google location changed is ended) the first time anyone looks, even before
// Google's next numbers arrive.

import { displayedTenths, ratioToNumber } from '../../domain/rating-goal-numbers'
import { currentPacePerWeek, paceRatio } from '../../domain/rating-goal-pace'
import { weeklySeries, weeklySeriesStart } from '../../domain/rating-goal-weeks'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type {
  RatingGoalCardView,
  RatingGoalDetailView,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '../dto/rating-goal.types'
import {
  buildCardView,
  buildSetupView,
  changeView,
  forecastFor,
  goalBasis,
  historyEntry,
  mixView,
  nextTenthView,
  planProgressView,
  stillNeeded,
  tenthsToRating,
} from '../rating-goal-views'
import type { GoalActor } from './goal-program-shared'
import {
  authorizeRatingGoal,
  evaluateActiveRatingGoal,
  requireReading,
  type EvaluatedRatingGoal,
  type RatingGoalDependencies,
} from './rating-goal-shared'

/** History shows at most this many reached and ended goals. */
const RATING_GOAL_HISTORY_LIMIT = 20
/** The detail shows at most this many changes. */
const RATING_GOAL_CHANGE_LOG_LIMIT = 50

export type RatingGoalPropertyInput = Readonly<{ propertyId: string }>

const round2 = (value: number): number => Math.round(value * 100) / 100

/** "Pick a plan": Google's numbers, eligibility, plans, stops, paces and forecasts. */
export async function getRatingGoalSetup(
  deps: RatingGoalDependencies,
  input: RatingGoalPropertyInput,
  actor: GoalActor,
): Promise<RatingGoalSetupView> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.read')
  const [reading, active, years] = await Promise.all([
    requireReading(deps, actor.organizationId, input.propertyId, deps.now()),
    deps.repository.findActive(actor.organizationId, input.propertyId),
    deps.reviews.getYearlyTotals(
      toOrganizationId(actor.organizationId),
      toPropertyId(input.propertyId),
    ),
  ])
  return buildSetupView(reading, active !== null, years)
}

const cardOf = (evaluated: EvaluatedRatingGoal): RatingGoalCardView =>
  buildCardView(evaluated.goal, evaluated.evaluation.status, evaluated.reading, {
    thisWeek: evaluated.thisWeekCount,
  })

/** The simple card of the active goal, or null when the Property has none. */
export async function getRatingGoalCard(
  deps: RatingGoalDependencies,
  input: RatingGoalPropertyInput,
  actor: GoalActor,
): Promise<RatingGoalCardView | null> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.read')
  const active = await deps.repository.findActive(actor.organizationId, input.propertyId)
  if (active === null) return null
  return cardOf(await evaluateActiveRatingGoal(deps, active))
}

/** The monitoring view of the active goal, or null when the Property has none. */
export async function getRatingGoalDetail(
  deps: RatingGoalDependencies,
  input: RatingGoalPropertyInput,
  actor: GoalActor,
): Promise<RatingGoalDetailView | null> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.read')
  const active = await deps.repository.findActive(actor.organizationId, input.propertyId)
  if (active === null) return null
  const evaluated = await evaluateActiveRatingGoal(deps, active)
  const { goal, reading } = evaluated
  const org = toOrganizationId(goal.organizationId)
  const property = toPropertyId(goal.propertyId)
  const timezone = reading.facts.timezone
  const [weekCounts, starsSinceSet, changes] = await Promise.all([
    deps.reviews.getWeeklyCounts(
      org,
      property,
      weeklySeriesStart(goal.createdAt, reading.now, timezone),
    ),
    deps.reviews.getStarDistribution(org, property, goal.createdAt),
    deps.repository.listChanges(
      goal.organizationId,
      goal.propertyId,
      goal.id,
      RATING_GOAL_CHANGE_LOG_LIMIT,
    ),
  ])
  // At the quality the goal now expects of new reviews (planned, then theirs).
  const basis = goalBasis(goal, reading)?.basis ?? null
  const actualPace = currentPacePerWeek(reading.reviewsLast28Days)
  const climbing = basis !== null && goal.paceTenthsPerWeek !== null
  return {
    ...cardOf(evaluated),
    lastFourWeeksPerWeek: round2(ratioToNumber(actualPace)),
    ...stillNeeded(goal, basis),
    forecastAtChosenPace: climbing
      ? forecastFor(
          basis,
          reading,
          goal.targetTenths,
          paceRatio(goal.paceTenthsPerWeek ?? 0),
        )
      : null,
    forecastAtActualPace: climbing
      ? forecastFor(basis, reading, goal.targetTenths, actualPace)
      : null,
    nextTenth: nextTenthView(goal, basis),
    recentMix: mixView(reading.mix),
    baseline: {
      googleShows: tenthsToRating(displayedTenths(goal.baseline.googleAverage)),
      reviewCount: goal.baseline.reviewCount,
      exactAverage: Math.round(goal.baseline.exactAverage * 1000) / 1000,
    },
    weeks: weeklySeries(goal.createdAt, reading.now, timezone, weekCounts),
    starsSinceSet,
    changes: changes.map(changeView),
    plan: planProgressView(goal, reading),
  }
}

/** Reached and ended goals, newest first. */
export async function getRatingGoalHistory(
  deps: RatingGoalDependencies,
  input: RatingGoalPropertyInput,
  actor: GoalActor,
): Promise<readonly RatingGoalHistoryEntry[]> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.read')
  const goals = await deps.repository.listHistory(
    actor.organizationId,
    input.propertyId,
    RATING_GOAL_HISTORY_LIMIT,
  )
  return goals.map(historyEntry)
}
