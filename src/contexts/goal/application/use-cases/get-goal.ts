// Goal context — get goal use case
// Loads a single goal with its progress. For recurring templates, also loads
// all instances sorted by periodStart descending.

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import type { GoalWithProgress } from './list-goals'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { ok, err, type Result } from 'neverthrow'

// ── Return types ───────────────────────────────────────────────────────────

export type GoalDetail = Readonly<{
  goal: Goal
  progress: GoalProgress | null
  instances?: ReadonlyArray<GoalWithProgress> // only for recurring templates
}>

// ── Error types ────────────────────────────────────────────────────────────

export type GetGoalError = { tag: 'forbidden' } | { tag: 'goal_not_found' }

// ── Dependencies ───────────────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type GetGoalDeps = Readonly<{
  goalRepo: GoalRepository
}>

// ── Use case ───────────────────────────────────────────────────────────────

export const getGoal =
  (deps: GetGoalDeps) =>
  async (input: {
    goalId: GoalId
    organizationId: OrganizationId
    role: Role
  }): Promise<Result<GoalDetail, GetGoalError>> => {
    if (!can(input.role, 'goal.read')) {
      return err({ tag: 'forbidden' })
    }

    const goal = await deps.goalRepo.getById(input.goalId, input.organizationId)
    if (!goal) {
      return err({ tag: 'goal_not_found' })
    }

    const [progressMap] = await Promise.all([deps.goalRepo.getProgressBatch([goal.id])])
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
          ? await deps.goalRepo.getProgressBatch(instanceIds)
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
