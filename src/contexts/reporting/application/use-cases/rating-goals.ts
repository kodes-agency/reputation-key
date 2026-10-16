// Property Google rating goal — the request surface and the evaluator.
//
// A rating goal is not a Goal Program: it shares the Goal permissions, the
// goal.use capability and the request policy, nothing else. Each request binds
// the caller's policy, as the Goal Program request API does.

import type {
  RatingGoalCardView,
  RatingGoalChangeResult,
  RatingGoalDetailRead,
  RatingGoalEndResult,
  RatingGoalHistoryEntry,
  RatingGoalNotNowResult,
  RatingGoalSetResult,
  RatingGoalSetupView,
} from '../dto/rating-goal.types'
import type { GoalActor, GoalExecutionPolicy } from './goal-program-shared'
import {
  changeRatingGoal,
  endRatingGoal,
  setRatingGoal,
  type ChangeRatingGoalInput,
  type EndRatingGoalInput,
  type SetRatingGoalInput,
} from './rating-goal-commands'
import { deferRatingGoal } from './rating-goal-not-now'
import {
  getRatingGoalCard,
  getRatingGoalDetail,
  getRatingGoalHistory,
  getRatingGoalSetup,
  type RatingGoalPropertyInput,
} from './rating-goal-reads'
import {
  evaluateActiveRatingGoal,
  type EvaluatedRatingGoal,
  type RatingGoalDependencies,
  type RatingGoalEvaluationDependencies,
} from './rating-goal-shared'

export type {
  ChangeRatingGoalInput,
  EndRatingGoalInput,
  RatingGoalPropertyInput,
  SetRatingGoalInput,
}

type Request<I, O> = (
  policy: GoalExecutionPolicy,
  input: I,
  actor: GoalActor,
) => Promise<O>

export type RatingGoalRequestApi = Readonly<{
  setup: Request<RatingGoalPropertyInput, RatingGoalSetupView>
  card: Request<RatingGoalPropertyInput, RatingGoalCardView | null>
  /** The low reviews still carry Review's ids: the server function links them to the Inbox. */
  detail: Request<RatingGoalPropertyInput, RatingGoalDetailRead | null>
  history: Request<RatingGoalPropertyInput, readonly RatingGoalHistoryEntry[]>
  set: Request<SetRatingGoalInput, RatingGoalSetResult>
  change: Request<ChangeRatingGoalInput, RatingGoalChangeResult>
  end: Request<EndRatingGoalInput, RatingGoalEndResult>
  /** "Not now": the setup checklist stops reminding; no goal is set or changed. */
  defer: Request<RatingGoalPropertyInput, RatingGoalNotNowResult>
}>

export function createRatingGoalRequestApi(
  deps: Omit<RatingGoalDependencies, 'policy'>,
): RatingGoalRequestApi {
  const bind =
    <I, O>(
      run: (deps: RatingGoalDependencies, input: I, actor: GoalActor) => Promise<O>,
    ) =>
    (policy: GoalExecutionPolicy, input: I, actor: GoalActor) =>
      run({ ...deps, policy }, input, actor)
  return Object.freeze({
    setup: bind(getRatingGoalSetup),
    card: bind(getRatingGoalCard),
    detail: bind(getRatingGoalDetail),
    history: bind(getRatingGoalHistory),
    set: bind(setRatingGoal),
    change: bind(changeRatingGoal),
    end: bind(endRatingGoal),
    defer: bind(deferRatingGoal),
  })
}

/** Evaluates a Property's active rating goal, if it has one. */
export type EvaluatePropertyRatingGoal = (
  organizationId: string,
  propertyId: string,
) => Promise<EvaluatedRatingGoal | null>

export function createRatingGoalEvaluator(
  deps: RatingGoalEvaluationDependencies,
): EvaluatePropertyRatingGoal {
  return async (organizationId, propertyId) => {
    const active = await deps.repository.findActive(organizationId, propertyId)
    return active === null ? null : evaluateActiveRatingGoal(deps, active)
  }
}

/**
 * Ends a Property's active rating goal because the Property was archived:
 * `property_archived`, when the goal was set before the archive's epoch.
 * True when a goal ended.
 */
export type EndArchivedPropertyRatingGoal = (
  archive: Readonly<{
    organizationId: string
    propertyId: string
    archivedEpoch: number
  }>,
) => Promise<boolean>

export function createArchivedPropertyRatingGoalEnder(
  deps: Pick<RatingGoalEvaluationDependencies, 'repository' | 'now'>,
): EndArchivedPropertyRatingGoal {
  return (archive) =>
    deps.repository.endForArchivedProperty({ ...archive, endedAt: deps.now() })
}
