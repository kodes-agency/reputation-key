// Goal context — get goal use case
// Loads a single goal with its progress. For recurring templates, also loads
// all instances sorted by periodStart descending.

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import type { GoalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GoalWithProgress } from './list-goals'
import { canForContext } from '#/shared/domain/permissions'
import { ok, err, type Result } from '#/shared/domain'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'

// ── Input type ────────────────────────────────────────────────────────────

export type GetGoalInput = Readonly<{
  goalId: GoalId
}>

// ── Return types ───────────────────────────────────────────────────────────

export type GoalDetail = Readonly<{
  goal: Goal
  progress: GoalProgress | null
  instances?: ReadonlyArray<GoalWithProgress> // only for recurring templates
}>

// ── Error types ────────────────────────────────────────────────────────────

export type GetGoalError = { tag: 'forbidden' } | { tag: 'goal_not_found' }

// ── Dependencies ───────────────────────────────────────────────────────────
export type GetGoalDeps = Readonly<{
  goalRepo: GoalRepository
  staffPublicApi: StaffPublicApi
}>

// ── Use case ───────────────────────────────────────────────────────────────

export const getGoal =
  (deps: GetGoalDeps) =>
  async (
    input: GetGoalInput,
    ctx: AuthContext,
  ): Promise<Result<GoalDetail, GetGoalError>> => {
    if (!canForContext(ctx, 'goal.read')) {
      return err({ tag: 'forbidden' })
    }

    const goal = await deps.goalRepo.getById(input.goalId, ctx.organizationId)
    if (!goal) {
      return err({ tag: 'goal_not_found' })
    }

    // D6-001: PropertyManager/Staff must be assigned to the goal's property.
    // Scope resolved per-permission (goal.read): org-wide → all; assigned → set.
    const accessible = await isPropertyAccessibleForPermission(
      (orgId, uId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      ctx,
      'goal.read',
      goal.propertyId,
    )
    if (!accessible) {
      return err({ tag: 'forbidden' })
    }

    const progressMap = await deps.goalRepo.getProgressBatch(
      [goal.id],
      goal.organizationId,
    )
    const progress = progressMap.get(goal.id) ?? null

    // For recurring templates, load all instances with their progress
    if (goal.goalType === 'recurring') {
      const instances = await deps.goalRepo.listInstances(goal.id, goal.organizationId)

      // Sort instances by periodStart descending
      const sorted = [...instances].sort((a, b) => {
        const aTime = a.periodStart?.getTime() ?? 0
        const bTime = b.periodStart?.getTime() ?? 0
        return bTime - aTime
      })

      // Batch fetch progress for all instances
      const instanceIds = sorted.map((i) => i.id)
      const instanceProgressMap =
        instanceIds.length > 0
          ? await deps.goalRepo.getProgressBatch(instanceIds, goal.organizationId)
          : new Map<GoalId, GoalProgress | null>()

      const instancesWithProgress: GoalWithProgress[] = []
      for (const instance of sorted) {
        const instanceProgress = instanceProgressMap.get(instance.id) ?? null
        instancesWithProgress.push({ goal: instance, progress: instanceProgress })
      }

      return ok({ goal, progress, instances: instancesWithProgress })
    }

    return ok({ goal, progress })
  }

// fallow-ignore-next-line unused-type
export type GetGoal = ReturnType<typeof getGoal>
