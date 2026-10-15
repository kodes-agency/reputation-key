// Property Google rating goal — "Not now".
//
// The Property setup checklist counts its rating goal step as done when a goal
// is active or a manager chose "Not now" for it (ADR 0067; the owner's call of
// 2026-10-14). The choice is offered where the step reminds: the checklist
// strip and the last step of a single-Property Google import. It asks what
// setting a goal asks (goal.create, goal.use, the Property's grant), sets no
// goal and changes none: a goal can still be set at any time, and one set
// later completes the step whether or not the choice is there.

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
