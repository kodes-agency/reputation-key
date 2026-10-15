// Server-only request plumbing for the Property Google rating goal server
// functions (rating-goals.ts). It reaches the composition root and the
// server-only error throwers, so it lives in a *.server.ts module, as the Goal
// Program plumbing does; called only inside handler bodies, the import is
// stripped from the client with them.
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { isRatingGoalError, type RatingGoalErrorCode } from '../domain/rating-goal'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
} from '../application/use-cases/goal-programs'
import type { RatingGoalRequestApi } from '../application/use-cases/rating-goals'
import { requestActor, requestPolicy } from './goal-program-request.server'

const ratingGoalStatus = (code: RatingGoalErrorCode): number => {
  switch (code) {
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'not_eligible':
    case 'goal_exists':
    case 'not_active':
    case 'version_conflict':
    case 'organization_closing':
      return 409
    case 'invalid_target':
    case 'invalid_quality':
    case 'invalid_pace':
    case 'no_change':
      return 400
  }
}

/**
 * Runs one rating goal request: resolves the tenant, binds the Goal request
 * policy (goal.* permissions, goal.use, the Property grant), and maps a
 * RatingGoalError to its HTTP status once.
 */
export async function withRatingGoals<T>(
  run: (
    ratingGoals: RatingGoalRequestApi,
    policy: GoalExecutionPolicy,
    actor: GoalActor,
  ) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  const ratingGoals = getContainer().goalPublicApi.ratingGoals
  try {
    return await run(ratingGoals, requestPolicy(ctx), requestActor(ctx))
  } catch (error) {
    if (isRatingGoalError(error)) {
      throwContextError('RatingGoalError', error, ratingGoalStatus(error.code))
    }
    if (error instanceof GoalProgramError && error.code === 'forbidden') {
      throwContextError('RatingGoalError', error, 403)
    }
    throw catchUntagged(error)
  }
}
