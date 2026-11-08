// Keep composition and error helpers server-only. Exporting this plain helper
// from an RPC module would leak server imports into the browser; handler-only
// imports are stripped with the handler bodies.

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
import type { GoalProgressRequestApi } from '../application/use-cases/goal-progress'
import type { GoalListProgressRequestApi } from '../application/use-cases/goal-list-progress'
import type { MonthlyPortalGoalRequestApi } from '../application/use-cases/monthly-portal-goal-page'
import type { PortalGoalAddRequestApi } from '../application/use-cases/portal-goal-add'
import type { PortalGoalSinglePageRequestApi } from '../monthly-goals/get-portal-goal-page.server'

export const requestActor = (
  ctx: Awaited<ReturnType<typeof resolveTenantContext>>,
): GoalActor => ctx

/**
 * The request's Goal policy: the caller acts only as themselves in their own
 * Organization, and every action asks the execution policy with goal.use on
 * the Property. The Property Google rating goal requests use it too.
 */
export const requestPolicy = (
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
    case 'staff_scan_only':
    case 'staff_scan_targets_disabled':
    case 'staff_private_ratings_skipped':
    case 'private_ratings_skipped':
    case 'start_month_changed':
    case 'month_locked':
    case 'no_open_month':
    case 'organization_closing':
    case 'check_in_closed':
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
    programs: GoalProgramRequestApi &
      GoalProgressRequestApi &
      GoalListProgressRequestApi &
      MonthlyPortalGoalRequestApi &
      PortalGoalAddRequestApi &
      PortalGoalSinglePageRequestApi,
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
