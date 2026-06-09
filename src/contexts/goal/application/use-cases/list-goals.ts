// Goal context — list goals use case
// Lists goals with their progress, enriches recurring templates with active
// instance progress, and sorts by status bucket (active→completed→expired→cancelled)
// then by newest first within each bucket.

import type { GoalRepository, GoalListFilter } from '../ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import type { GoalId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { err, ok, type Result } from '#/shared/domain'

// ── Input type ────────────────────────────────────────────────────────────

export type ListGoalsInput = Readonly<GoalListFilter & { role: Role }>

// ── Return types ───────────────────────────────────────────────────────────

export type GoalWithProgress = Readonly<{
  goal: Goal
  progress: GoalProgress | null
}>

// ── Error types ────────────────────────────────────────────────────────────

export type ListGoalsError = { tag: 'forbidden' }

// ── Dependencies ───────────────────────────────────────────────────────────

export type ListGoalsDeps = Readonly<{
  goalRepo: GoalRepository
}>

// ── Status sort order ──────────────────────────────────────────────────────

const STATUS_SORT_ORDER: Record<Goal['status'], number> = {
  active: 0,
  completed: 1,
  expired: 2,
  cancelled: 3,
}

// ── Use case ───────────────────────────────────────────────────────────────

export const listGoals =
  (deps: ListGoalsDeps) =>
  async (
    input: ListGoalsInput,
  ): Promise<Result<ReadonlyArray<GoalWithProgress>, ListGoalsError>> => {
    if (!can(input.role, 'goal.read')) {
      return err({ tag: 'forbidden' })
    }

    const { role: _role, ...filter } = input
    const goals = await deps.goalRepo.list(filter)

    if (goals.length === 0) {
      return ok([])
    }

    // Batch 1: fetch progress for all goals in one query
    const allGoalIds = goals.map((g) => g.id)
    const progressMap = await deps.goalRepo.getProgressBatch(allGoalIds)

    // Batch 2: for recurring templates, fetch instances in one query
    const recurringParents = goals.filter((g) => g.goalType === 'recurring')
    const instanceMap =
      recurringParents.length > 0
        ? await deps.goalRepo.listInstancesBatch(
            recurringParents.map((g) => g.id),
            filter.organizationId,
          )
        : new Map<GoalId, Goal[]>()

    // Batch 3: collect all instance IDs and fetch their progress
    const allInstanceIds: GoalId[] = []
    for (const instances of instanceMap.values()) {
      for (const inst of instances) {
        allInstanceIds.push(inst.id)
      }
    }
    const instanceProgressMap =
      allInstanceIds.length > 0
        ? await deps.goalRepo.getProgressBatch(allInstanceIds)
        : new Map<GoalId, GoalProgress | null>()

    const results: GoalWithProgress[] = []

    for (const goal of goals) {
      let progress: GoalProgress | null = progressMap.get(goal.id) ?? null

      // For recurring templates, find the current active instance and use its progress
      if (goal.goalType === 'recurring') {
        const instances = instanceMap.get(goal.id) ?? []
        const activeInstance = instances.find((i) => i.status === 'active')
        if (activeInstance) {
          const instanceProgress = instanceProgressMap.get(activeInstance.id) ?? null
          if (instanceProgress) {
            progress = instanceProgress
          }
        }
      }

      results.push({ goal, progress })
    }

    // Sort: status bucket ascending, then createdAt descending within bucket
    results.sort((a, b) => {
      const statusDiff =
        STATUS_SORT_ORDER[a.goal.status] - STATUS_SORT_ORDER[b.goal.status]
      if (statusDiff !== 0) return statusDiff
      return b.goal.createdAt.getTime() - a.goal.createdAt.getTime()
    })

    return ok(results)
  }

export type ListGoals = ReturnType<typeof listGoals>
