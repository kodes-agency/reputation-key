// "Not now" answers the setup step without creating or changing a goal (ADR 0067).
// Require the same goal.create, goal.use and Property grant as setting one;
// a goal may still be set later.

import { ratingGoalError } from '../../domain/rating-goal'
import type { RatingGoalNotNowResult } from '../dto/rating-goal.types'
import type { GoalActor } from './goal-program-shared'
import type { RatingGoalPropertyInput } from './rating-goal-reads'
import { authorizeRatingGoal, type RatingGoalDependencies } from './rating-goal-shared'

export async function deferRatingGoal(
  deps: RatingGoalDependencies,
  input: RatingGoalPropertyInput,
  actor: GoalActor,
): Promise<RatingGoalNotNowResult> {
  await authorizeRatingGoal(deps, actor, input.propertyId, 'goal.create')
  const facts = await deps.properties.findPropertyFacts(
    actor.organizationId,
    input.propertyId,
  )
  if (facts === null) throw ratingGoalError('not_found', 'Property not found')
  await deps.repository.recordNotNow({
    organizationId: actor.organizationId,
    propertyId: input.propertyId,
    chosenBy: actor.userId,
    chosenAt: deps.now(),
  })
  return { propertyId: input.propertyId }
}
