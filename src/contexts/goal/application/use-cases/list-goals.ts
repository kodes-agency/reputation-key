// Goal context — list goals use case
// Lists goals with their progress, enriches recurring templates with active
// instance progress, and sorts by status bucket (active→completed→expired→cancelled)
// then by newest first within each bucket.

import type { GoalRepository, GoalListFilter } from '../ports/goal.repository'
import type { Goal, GoalProgress } from '../../domain/types'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { err, ok, type Result } from 'neverthrow'

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
    input: GoalListFilter & { role: Role },
  ): Promise<Result<ReadonlyArray<GoalWithProgress>, ListGoalsError>> => {
    if (!can(input.role, 'goal.read')) {
      return err({ tag: 'forbidden' })
    }

    const { role: _role, ...filter } = input
    const goals = await deps.goalRepo.list(filter)

    const results: GoalWithProgress[] = []

    for (const goal of goals) {
      let progress: GoalProgress | null = await deps.goalRepo.getProgress(goal.id)

      // For recurring templates, find the current active instance and use its progress
      if (goal.goalType === 'recurring') {
        const instances = await deps.goalRepo.listInstances(goal.id, goal.organizationId)
        const activeInstance = instances.find((i) => i.status === 'active')
        if (activeInstance) {
          const instanceProgress = await deps.goalRepo.getProgress(activeInstance.id)
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
