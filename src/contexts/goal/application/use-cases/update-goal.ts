// Goal context — update-goal use case
// Updates targetValue and/or recurrenceRule on an active goal.
// Per architecture: "Dependencies are passed as function arguments."

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal, RecurrenceRule } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import { ok, err, type Result } from 'neverthrow'

// ── Input type ──────────────────────────────────────────────────────────

export type UpdateGoalInput = Readonly<{
  goalId: GoalId
  organizationId: OrganizationId
  targetValue?: number
  recurrenceRule?: RecurrenceRule | null
}>

// ── Error types ─────────────────────────────────────────────────────────

export type UpdateGoalError =
  | { tag: 'goal_not_found' }
  | { tag: 'goal_not_active'; status: string }
  | { tag: 'recurrence_rule_not_allowed' }

// ── Deps ────────────────────────────────────────────────────────────────

export type UpdateGoalDeps = Readonly<{
  goalRepo: GoalRepository
  clock: () => Date
}>

// ── Use case ────────────────────────────────────────────────────────────

export const updateGoal =
  (deps: UpdateGoalDeps) =>
  async (input: UpdateGoalInput): Promise<Result<Goal, UpdateGoalError>> => {
    // 1. Load goal
    const goal = await deps.goalRepo.getById(input.goalId, input.organizationId)
    if (!goal) {
      return err({ tag: 'goal_not_found' })
    }

    // 2. Must be active
    if (goal.status !== 'active') {
      return err({ tag: 'goal_not_active', status: goal.status })
    }

    // 3. Build update data
    const now = deps.clock()
    const updates: Record<string, unknown> = {
      updatedAt: now,
    }

    if (input.targetValue !== undefined) {
      updates.targetValue = input.targetValue
    }

    if (input.recurrenceRule !== undefined) {
      // Only recurring templates can have recurrenceRule updated
      if (goal.goalType !== 'recurring') {
        return err({ tag: 'recurrence_rule_not_allowed' })
      }
      updates.recurrenceRule = input.recurrenceRule
    }

    // 4. Persist
    const updated = await deps.goalRepo.update(
      input.goalId,
      input.organizationId,
      updates as Parameters<typeof deps.goalRepo.update>[2],
    )

    // Repo returns null if not found (shouldn't happen since we just checked)
    if (!updated) {
      return err({ tag: 'goal_not_found' })
    }

    return ok(updated)
  }
