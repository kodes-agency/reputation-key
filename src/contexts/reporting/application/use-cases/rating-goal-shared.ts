// Property Google rating goal — what its use cases share.
//
// Authorization is the Goal one (ADR 0049): goal.read / create / update /
// cancel on the Property, capability goal.use, a PropertyManager limited by a
// current PropertyAccessGrant. The policy is asked before anything is read.

import { ratingGoalError, type PropertyRatingGoal } from '../../domain/rating-goal'
import type { RatingGoalNotice } from '../../domain/rating-goal-notices'
import { statusPaceWindow } from '../../domain/rating-goal-status'
import { weekStartInstant } from '../../domain/rating-goal-weeks'
import type {
  PropertyRatingGoalRepository,
  RatingGoalPropertyFacts,
} from '../ports/property-rating-goal.repository'
import {
  readRatingGoalInputs,
  type RatingGoalReadDeps,
  type RatingGoalReading,
} from '../rating-goal-reading'
import {
  evaluateRatingGoal,
  recordRatingGoalEvaluation,
  type RatingGoalEvaluation,
} from '../rating-goal-evaluation'
import type { GoalActor, GoalExecutionPolicy } from './goal-program-shared'

export type RatingGoalDependencies = RatingGoalReadDeps &
  Readonly<{
    repository: PropertyRatingGoalRepository
    policy: GoalExecutionPolicy
    id: () => string
    now: () => Date
  }>

/** The dependencies an evaluation needs; no policy (the consumer is gated). */
export type RatingGoalEvaluationDependencies = RatingGoalReadDeps &
  Readonly<{
    repository: PropertyRatingGoalRepository
    now: () => Date
  }>

export type RatingGoalAction = 'goal.read' | 'goal.create' | 'goal.update' | 'goal.cancel'

export async function authorizeRatingGoal(
  deps: Pick<RatingGoalDependencies, 'policy'>,
  actor: GoalActor,
  propertyId: string,
  action: RatingGoalAction,
): Promise<void> {
  await deps.policy.authorize({
    actor,
    organizationId: actor.organizationId,
    propertyId,
    action,
  })
}

/** The Property's numbers, or `not_found` when it is not the Organization's. */
export async function requireReading(
  deps: RatingGoalReadDeps,
  organizationId: string,
  propertyId: string,
  now: Date,
  extraCountSince?: (facts: RatingGoalPropertyFacts) => readonly Date[],
): Promise<RatingGoalReading> {
  const reading = await readRatingGoalInputs(
    deps,
    organizationId,
    propertyId,
    now,
    extraCountSince,
  )
  if (reading === null) throw ratingGoalError('not_found', 'Property not found')
  return reading
}

export type EvaluatedRatingGoal = Readonly<{
  /** The goal as it now stands: reached or ended when this evaluation took that step. */
  goal: PropertyRatingGoal
  /**
   * What the goal held before. With `stored`, it tells a transition (a tenth
   * gained or lost, a new status, reached, ended) from a repeat, once: a
   * concurrent evaluation that stored the same change first leaves this one
   * `stored: false`.
   */
  previous: Pick<PropertyRatingGoal, 'state' | 'lastEvaluation'>
  stored: boolean
  /** What this evaluation told the goal's managers: none unless it was stored. */
  notices: readonly RatingGoalNotice[]
  evaluation: RatingGoalEvaluation
  reading: RatingGoalReading
  /** Reviews created this Property-local week. */
  thisWeekCount: number
}>

/**
 * Reads an active goal's numbers (with this week and its pace window),
 * evaluates it and stores the evaluation. The goal comes back as it now
 * stands: reached or ended when this evaluation took that step.
 */
export async function evaluateActiveRatingGoal(
  deps: RatingGoalEvaluationDependencies,
  goal: PropertyRatingGoal,
): Promise<EvaluatedRatingGoal> {
  const now = deps.now()
  const window = statusPaceWindow(goal.createdAt, now)
  const reading = await requireReading(
    deps,
    goal.organizationId,
    goal.propertyId,
    now,
    (facts) => [weekStartInstant(now, facts.timezone), window?.start ?? now],
  )
  const [thisWeekCount = 0, paceWindowCount = 0] = reading.extraCounts
  const evaluation = evaluateRatingGoal(goal, reading, window ? paceWindowCount : null)
  const recorded = await recordRatingGoalEvaluation(
    deps.repository,
    goal,
    evaluation,
    { pace: window ? { reviews: paceWindowCount, window } : null },
    now,
  )
  return {
    goal: recorded.goal,
    previous: { state: goal.state, lastEvaluation: goal.lastEvaluation },
    stored: recorded.stored,
    notices: recorded.notices,
    evaluation,
    reading,
    thisWeekCount,
  }
}
