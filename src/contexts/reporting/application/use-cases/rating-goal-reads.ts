// Property Google rating goal — the reads: setup, simple card, detail, history.
//
// The setup read also asks Review for each calendar year's totals: the best
// year is evidence for the plans' quality ("Like your best year"). Since rounds
// 3 and 4 it asks, in the same parallel read, for each calendar month's totals
// with ten reviews and the reviews per local date: the best month and the
// busiest 30 days the one-screen setup plans from (PLAN-R4 D18). Over generous
// UTC bounds; the domain trims them to the Property's calendar.
//
// The card and the detail evaluate the active goal as they read it, through
// the same evaluation the snapshot consumer runs, so a goal Google now shows
// the target of is reached (and one whose Property was archived or whose
// Google location changed is ended) the first time anyone looks, even before
// Google's next numbers arrive.

import { actualRate, chosenRate } from '../../domain/rating-goal-arrival'
import { weeklySeries, weeklySeriesStart } from '../../domain/rating-goal-weeks'
import {
  DAY_READ_LOOKBACK_DAYS,
  EVIDENCE_MIN_REVIEWS,
  MONTH_READ_LOOKBACK_DAYS,
} from '../../domain/rating-goal-evidence'
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
  bestCaseNeeded,
  buildCardView,
  buildSetupView,
  changeView,
  goalBasis,
  historyEntry,
  mixView,
  planProgressView,
} from '../rating-goal-views'
import { forecastFor } from '../rating-goal-tracking-views'
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

const DAY_MS = 24 * 60 * 60 * 1000
const daysBefore = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * DAY_MS)

/**
 * The setup: Google's numbers, eligibility and the exact inputs the one-screen
 * setup works its plan out from (with `offersClimb` and `offerKeepFirst`).
 */
export async function getRatingGoalSetup(
  deps: RatingGoalDependencies,
  input: RatingGoalPropertyInput,
  actor: GoalActor,
): Promise<RatingGoalSetupView> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.read')
  const now = deps.now()
  const org = toOrganizationId(actor.organizationId)
  const property = toPropertyId(input.propertyId)
  const [reading, active, years, months, days] = await Promise.all([
    requireReading(deps, actor.organizationId, input.propertyId, now),
    deps.repository.findActive(actor.organizationId, input.propertyId),
    deps.reviews.getYearlyTotals(org, property),
    deps.reviews.getMonthlyTotals(
      org,
      property,
      daysBefore(now, MONTH_READ_LOOKBACK_DAYS),
      EVIDENCE_MIN_REVIEWS,
    ),
    deps.reviews.getDailyCounts(org, property, daysBefore(now, DAY_READ_LOOKBACK_DAYS)),
  ])
  return buildSetupView(reading, active !== null, { years, months, days })
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
  // At the quality the goal now expects of new reviews: the plan's, the plan
  // mixed with new reviews, or theirs while too low (trackingMix).
  const basis = goalBasis(goal, reading)?.basis ?? null
  const pace = goal.paceTenthsPerWeek
  const climbing = basis !== null && pace !== null
  return {
    ...cardOf(evaluated),
    bestCase: bestCaseNeeded(goal, basis),
    forecastAtChosenPace: climbing
      ? forecastFor(basis, goal.targetTenths, chosenRate(pace))
      : null,
    forecastAtActualPace: climbing
      ? forecastFor(basis, goal.targetTenths, actualRate(reading.reviewsLast28Days))
      : null,
    recentMix: mixView(reading.mix),
    weeks: weeklySeries(goal.createdAt, reading.now, timezone, weekCounts),
    starsSinceSet,
    changes: changes.recent.map(changeView),
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
