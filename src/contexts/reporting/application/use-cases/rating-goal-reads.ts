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
//
// Since round 5 (D-2b, the owner's exception) the detail also reads the low
// reviews since the set and this week's star split, live: the rows go to the
// server function with Review's ids, which it turns into Inbox items.

import { actualRate, chosenRate } from '../../domain/rating-goal-arrival'
import {
  DAY_READ_LOOKBACK_DAYS,
  EVIDENCE_MIN_REVIEWS,
  MONTH_READ_LOOKBACK_DAYS,
} from '../../domain/rating-goal-evidence'
import {
  organizationId as toOrganizationId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import { thresholdThousandths } from '../../domain/rating-goal-numbers'
import { weekStartInstant } from '../../domain/rating-goal-weeks'
import type {
  RatingGoalCardView,
  RatingGoalDetailRead,
  RatingGoalHistoryEntry,
  RatingGoalSetupView,
} from '../dto/rating-goal.types'
import {
  buildCardView,
  buildSetupView,
  changeView,
  goalBasis,
  historyEntry,
  planProgressView,
} from '../rating-goal-views'
import { forecastFor } from '../rating-goal-tracking-views'
import {
  detailChartStart,
  detailHistoryStart,
  detailTracking,
} from '../rating-goal-detail-views'
import {
  LOW_REVIEW_READ_LIMIT,
  lowReviewRows,
  setbackNumbers,
  thisWeekView,
} from '../rating-goal-low-reviews'
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

/**
 * The monitoring view of the active goal, or null when the Property has none.
 * Its low reviews still carry Review's ids: the server function links them.
 */
export async function getRatingGoalDetail(
  deps: RatingGoalDependencies,
  input: RatingGoalPropertyInput,
  actor: GoalActor,
): Promise<RatingGoalDetailRead | null> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.read')
  const active = await deps.repository.findActive(actor.organizationId, input.propertyId)
  if (active === null) return null
  const evaluated = await evaluateActiveRatingGoal(deps, active)
  const { goal, reading } = evaluated
  const org = toOrganizationId(goal.organizationId)
  const property = toPropertyId(goal.propertyId)
  // The chart reads from four weeks before the set's week (a year back at most);
  // the weekly history from the latest plan change's week when that is earlier,
  // so it starts once the change log is in, beside Google's number.
  const chartFrom = detailChartStart(goal, reading).instant
  const changesRead = deps.repository.listChanges(
    goal.organizationId,
    goal.propertyId,
    goal.id,
    RATING_GOAL_CHANGE_LOG_LIMIT,
  )
  const setback = setbackNumbers(goal, reading)
  const [changes, history, shown, low, thisWeek] = await Promise.all([
    changesRead,
    changesRead.then((log) =>
      deps.reviews.getWeeklyHistory(
        org,
        property,
        detailHistoryStart(goal, reading, log).instant,
      ),
    ),
    deps.reviews.getShownNumberChanges(org, property, chartFrom),
    setback === null
      ? []
      : deps.reviews.getLowReviews(
          org,
          property,
          goal.createdAt,
          thresholdThousandths(goal.targetTenths),
          LOW_REVIEW_READ_LIMIT,
        ),
    deps.reviews.getStarDistribution(
      org,
      property,
      weekStartInstant(reading.now, reading.facts.timezone),
    ),
  ])
  // At the quality the goal now expects of new reviews: the plan's, the plan
  // mixed with new reviews, or theirs while too low (trackingMix).
  const basis = goalBasis(goal, reading)?.basis ?? null
  const pace = goal.paceTenthsPerWeek
  const climbing = basis !== null && pace !== null
  const card = cardOf(evaluated)
  const tracking = detailTracking({
    goal,
    reading,
    card,
    reads: { history, shown, changes },
  })
  return {
    ...card,
    forecastAtChosenPace: climbing
      ? forecastFor(basis, goal.targetTenths, chosenRate(pace))
      : null,
    forecastAtActualPace: climbing
      ? forecastFor(basis, goal.targetTenths, actualRate(reading.reviewsLast28Days))
      : null,
    changes: changes.recent.map(changeView),
    plan: planProgressView(goal, reading),
    ...tracking,
    moved: {
      ...tracking.moved,
      thisWeek: thisWeekView(thisWeek),
      lowReviews: lowReviewRows(setback, low),
    },
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
