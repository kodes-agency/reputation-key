// Property Google rating goal — the commands: set, change, end.
//
// Setting a goal needs Google's current numbers and at least ten Google
// reviews, and refuses while the Property has an active goal. It records the
// baselines the progress bar starts from. A change names the version its form
// was opened on, writes one log row per changed field and no reason. Ending
// is always allowed while the goal is active. Nothing here is a deadline.

import { ratioToNumber } from '../../domain/rating-goal-numbers'
import type { RatingGoalEligibility } from '../../domain/rating-goal-stops'
import {
  paceProblem,
  planChanges,
  ratingGoalError,
  targetProblem,
  type PropertyRatingGoal,
  type RatingGoalMode,
  type RatingGoalPlan,
} from '../../domain/rating-goal'
import type {
  RatingGoalChangeResult,
  RatingGoalEndResult,
  RatingGoalSetResult,
} from '../dto/rating-goal.types'
import type {
  NewPropertyRatingGoal,
  RatingGoalWriteResult,
} from '../ports/property-rating-goal.repository'
import { evaluateRatingGoal } from '../rating-goal-evaluation'
import {
  numbersEligibility,
  ratingBasis,
  setupEligibility,
  type RatingGoalReading,
} from '../rating-goal-reading'
import type { GoalActor } from './goal-program-shared'
import {
  authorizeRatingGoal,
  requireReading,
  type RatingGoalDependencies,
} from './rating-goal-shared'

export type SetRatingGoalInput = Readonly<{
  propertyId: string
  mode: RatingGoalMode
  targetTenths: number
  pacePerWeek: number | null
}>

export type ChangeRatingGoalInput = Readonly<{
  propertyId: string
  goalId: string
  expectedVersion: number
  mode?: RatingGoalMode
  targetTenths?: number
  pacePerWeek?: number | null
}>

export type EndRatingGoalInput = Readonly<{
  propertyId: string
  goalId: string
  expectedVersion: number
}>

/** The tenth Google shows now, when the eligibility lets a goal rely on it. */
function currentDisplayedTenths(
  reading: RatingGoalReading,
  eligibility: RatingGoalEligibility,
): number {
  const basis = ratingBasis(reading)
  if (!eligibility.eligible || basis === null) {
    throw ratingGoalError('not_eligible', 'A rating goal needs Google numbers', {
      reason: eligibility.eligible ? 'waiting_for_google' : eligibility.reason,
    })
  }
  return basis.displayedTenths
}

function assertPlan(plan: RatingGoalPlan, displayed: number | null): void {
  const problem =
    (displayed === null
      ? null
      : targetProblem(plan.mode, plan.targetTenths, displayed)) ??
    paceProblem(plan.mode, plan.pacePerWeek)
  if (problem !== null) {
    throw ratingGoalError(
      problem,
      `The rating goal ${problem.replace('invalid_', '')} is not allowed`,
    )
  }
}

function throwWriteRefusal(result: Exclude<RatingGoalWriteResult, 'written'>): never {
  throw result === 'version_conflict'
    ? ratingGoalError('version_conflict', 'The rating goal changed since it was opened')
    : ratingGoalError('not_active', 'The rating goal was reached or ended')
}

/** Sets the Property's rating goal and records its baselines. */
export async function setRatingGoal(
  deps: RatingGoalDependencies,
  input: SetRatingGoalInput,
  actor: GoalActor,
): Promise<RatingGoalSetResult> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.create')
  if (await deps.repository.isOrganizationHeld(actor.organizationId)) {
    throw ratingGoalError('organization_closing', 'The Organization is closing')
  }
  if (await deps.repository.findActive(actor.organizationId, input.propertyId)) {
    throw ratingGoalError('goal_exists', 'This Property already has a rating goal')
  }
  const reading = await requireReading(
    deps,
    actor.organizationId,
    input.propertyId,
    deps.now(),
  )
  assertPlan(input, currentDisplayedTenths(reading, setupEligibility(reading)))
  const goal = newGoal(deps.id(), input, actor, reading)
  const inserted = await deps.repository.insert(goal)
  if (inserted === 'active_exists') {
    throw ratingGoalError('goal_exists', 'This Property already has a rating goal')
  }
  return { goalId: goal.id, version: 1 }
}

/**
 * The goal a set stores: its plan, the binding it is set under, the baselines
 * its progress starts from, and what it starts at (the tenth Google shows and
 * the status, evaluated as any later evaluation would be).
 */
function newGoal(
  id: string,
  input: SetRatingGoalInput,
  actor: GoalActor,
  reading: RatingGoalReading,
): NewPropertyRatingGoal {
  const goal: NewPropertyRatingGoal = {
    id,
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    sourceEpoch: reading.facts.sourceEpoch,
    mode: input.mode,
    targetTenths: input.targetTenths,
    pacePerWeek: input.pacePerWeek,
    baseline: {
      reviewCount: reading.google?.reviewCount ?? 0,
      googleAverage: reading.google?.averageRating ?? 0,
      exactAverage: reading.exact ? ratioToNumber(reading.exact.value) : 0,
    },
    lastEvaluation: {
      displayedTenths: null,
      status: null,
      evaluatedAt: null,
      knownStatus: null,
      belowPaceNoticedAt: null,
      cantReachNoticedAt: null,
    },
    createdBy: actor.userId,
    createdAt: reading.now,
    updatedAt: reading.now,
  }
  const starting = evaluateRatingGoal(
    {
      ...goal,
      state: 'active',
      endedReason: null,
      reachedAt: null,
      endedAt: null,
      version: 1,
    },
    reading,
    null,
  )
  return {
    ...goal,
    // The status it starts in is known: the first change from it is a notice.
    lastEvaluation: {
      displayedTenths: starting.displayedTenths,
      status: starting.status,
      evaluatedAt: reading.now,
      knownStatus: starting.status === 'waiting_for_google' ? null : starting.status,
      belowPaceNoticedAt: null,
      cantReachNoticedAt: null,
    },
  }
}

/** The plan a change leaves: a keep goal has no pace. */
function nextPlan(
  goal: PropertyRatingGoal,
  input: ChangeRatingGoalInput,
): RatingGoalPlan {
  const mode = input.mode ?? goal.mode
  return {
    mode,
    targetTenths: input.targetTenths ?? goal.targetTenths,
    pacePerWeek:
      mode === 'keep'
        ? null
        : input.pacePerWeek !== undefined
          ? input.pacePerWeek
          : goal.pacePerWeek,
  }
}

async function loadChangeable(
  deps: RatingGoalDependencies,
  actor: GoalActor,
  input: Pick<ChangeRatingGoalInput, 'propertyId' | 'goalId' | 'expectedVersion'>,
): Promise<PropertyRatingGoal> {
  const goal = await deps.repository.findById(
    actor.organizationId,
    input.propertyId,
    input.goalId,
  )
  if (goal === null) throw ratingGoalError('not_found', 'Rating goal not found')
  if (goal.state !== 'active') throwWriteRefusal('not_active')
  if (goal.version !== input.expectedVersion) throwWriteRefusal('version_conflict')
  return goal
}

/** Changes the target, pace or mode of the active goal. */
export async function changeRatingGoal(
  deps: RatingGoalDependencies,
  input: ChangeRatingGoalInput,
  actor: GoalActor,
): Promise<RatingGoalChangeResult> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.update')
  const goal = await loadChangeable(deps, actor, input)
  const plan = nextPlan(goal, input)
  const changes = planChanges(goal, plan)
  if (changes.length === 0) throw ratingGoalError('no_change', 'Nothing changed')
  const now = deps.now()
  const targetMoves = plan.mode !== goal.mode || plan.targetTenths !== goal.targetTenths
  const reading = targetMoves
    ? await requireReading(deps, actor.organizationId, input.propertyId, now)
    : null
  // A change keeps a running goal going; only setting one needs an active Property.
  const displayed = reading
    ? currentDisplayedTenths(reading, numbersEligibility(reading))
    : null
  assertPlan(plan, displayed)
  const result = await deps.repository.changePlan({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    goalId: goal.id,
    expectedVersion: input.expectedVersion,
    plan,
    changes: changes.map((row) => ({
      ...row,
      id: deps.id(),
      goalId: goal.id,
      organizationId: actor.organizationId,
      propertyId: input.propertyId,
      changedBy: actor.userId,
      changedAt: now,
    })),
    changedAt: now,
  })
  if (result !== 'written') throwWriteRefusal(result)
  return { goalId: goal.id, version: input.expectedVersion + 1 }
}

/** Ends the active goal (a manager's decision). */
export async function endRatingGoal(
  deps: RatingGoalDependencies,
  input: EndRatingGoalInput,
  actor: GoalActor,
): Promise<RatingGoalEndResult> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.cancel')
  const goal = await loadChangeable(deps, actor, input)
  const result = await deps.repository.endByManager({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    goalId: goal.id,
    expectedVersion: input.expectedVersion,
    endedAt: deps.now(),
  })
  if (result !== 'written') throwWriteRefusal(result)
  return { goalId: goal.id, ended: true }
}
