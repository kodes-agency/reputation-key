// Server-only request plumbing for the Goal Program server functions.
//
// goal-programs.ts and goal-program-details.ts both run their handlers through
// `withGoalPrograms`. It reaches the composition root and the server-only
// error throwers, so it lives in a *.server.ts module: a server-function module
// that exported it would carry those imports into the client build, which the
// import protection refuses. Called only inside handler bodies, this import is
// stripped from the client with them.
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import {
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalProgramRequestApi,
} from '../application/use-cases/goal-programs'
import type { GoalMonthPreviewRequestApi } from '../application/use-cases/goal-month-preview'
import type { GoalProgressRequestApi } from '../application/use-cases/goal-progress'

const requestActor = (ctx: Awaited<ReturnType<typeof resolveTenantContext>>): GoalActor =>
  ctx

const requestPolicy = (
  ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
): GoalExecutionPolicy => ({
  authorize: async (request) => {
    if (
      request.actor === 'system' ||
      request.organizationId !== ctx.organizationId ||
      request.actor.userId !== ctx.userId
    ) {
      throw new GoalProgramError('forbidden')
    }
    await requireExecutionAllowed({
      actor: ctx,
      action: request.action,
      capability: 'goal.use',
      propertyId: request.propertyId,
    })
  },
})

const goalProgramStatus = (error: GoalProgramError): number => {
  switch (error.code) {
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'invalid_transition':
    case 'revision_conflict':
    case 'metric_unavailable':
    case 'subject_has_goal':
    case 'start_month_changed':
      return 409
    case 'invalid_name':
    case 'invalid_target':
    case 'invalid_subject':
    case 'duplicate_subject':
    case 'assignment_limit_exceeded':
      return 400
  }
}

/**
 * Runs one Goal Program request: resolves the tenant, binds the request
 * policy, and maps a GoalProgramError to its HTTP status once.
 */
export async function withGoalPrograms<T>(
  run: (
    programs: GoalProgramRequestApi & GoalProgressRequestApi & GoalMonthPreviewRequestApi,
    policy: GoalExecutionPolicy,
    actor: GoalActor,
  ) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext(await headersFromContext())
  const programs = getContainer().goalPublicApi.programs
  const policy = requestPolicy(ctx)
  try {
    return await run(programs, policy, requestActor(ctx))
  } catch (error) {
    if (error instanceof GoalProgramError) {
      throwContextError('GoalProgramError', error, goalProgramStatus(error))
    }
    throw catchUntagged(error)
  }
}
