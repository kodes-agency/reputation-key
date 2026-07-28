// Goal context — shared access guards for goal use cases (BQC-5.9 E10).
// Mirrors inbox/application/inbox-access.ts, adapted to the goal context's
// Result error channel. Single source of the D6-001 preamble: permission
// check → goal load → per-permission property-access check.

import type { GoalRepository } from './ports/goal.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { Goal } from '../domain/types'
import type { GoalId, PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import { canForContext } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { ok, err, type Result } from '#/shared/domain'

export type GoalAccessError = { tag: 'forbidden' } | { tag: 'goal_not_found' }

export type GoalAccessDeps = Readonly<{
  goalRepo: GoalRepository
  staffPublicApi: StaffPublicApi
}>

/**
 * Authorize `permission`, load the goal, and assert the caller can access
 * its property (D6-001). Scope is resolved PER PERMISSION via
 * scopeForPermission: org-wide scope (AccountAdmin) → all accessible;
 * assigned scope (PropertyManager/Staff) → staff_assignment properties.
 */
export const loadAccessibleGoal = async (
  deps: GoalAccessDeps,
  goalId: GoalId,
  ctx: AuthContext,
  permission: Permission,
): Promise<Result<Goal, GoalAccessError>> => {
  if (!canForContext(ctx, permission)) {
    return err({ tag: 'forbidden' })
  }

  const goal = await deps.goalRepo.getById(goalId, ctx.organizationId)
  if (!goal) {
    return err({ tag: 'goal_not_found' })
  }

  const access = await assertGoalPropertyAccessible(
    deps,
    ctx,
    permission,
    goal.propertyId,
  )
  if (access.isErr()) {
    return err(access.error)
  }
  return ok(goal)
}

/**
 * err({ tag: 'forbidden' }) when the caller lacks access to the given
 * property for `permission` (D6-001) — the property-level guard for use
 * cases that do not load a goal (create / list).
 */
export const assertGoalPropertyAccessible = async (
  deps: Readonly<{ staffPublicApi: StaffPublicApi }>,
  ctx: AuthContext,
  permission: Permission,
  propertyId: PropertyId,
): Promise<Result<void, { tag: 'forbidden' }>> => {
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, uId, orgWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
    ctx,
    permission,
    propertyId,
  )
  if (!accessible) {
    return err({ tag: 'forbidden' })
  }
  return ok(undefined)
}
