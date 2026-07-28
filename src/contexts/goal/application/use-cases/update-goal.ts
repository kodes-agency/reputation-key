// Goal context — update-goal use case
// Updates targetValue and/or recurrenceRule on an active goal.
// Per architecture: "Dependencies are passed as function arguments."

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal, RecurrenceRule } from '../../domain/types'
import type { GoalId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { ok, err, type Result } from '#/shared/domain'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { loadAccessibleGoal } from '../goal-access'

// ── Input type ──────────────────────────────────────────────────────────

export type UpdateGoalInput = Readonly<{
  goalId: GoalId
  targetValue?: number
  recurrenceRule?: RecurrenceRule | null
}>

// ── Error types ─────────────────────────────────────────────────────────

export type UpdateGoalError =
  | { tag: 'forbidden' }
  | { tag: 'goal_not_found' }
  | { tag: 'goal_not_active'; status: string }
  | { tag: 'recurrence_rule_not_allowed' }
  | { tag: 'invalid_target_value' }

// ── Deps ────────────────────────────────────────────────────────────────

export type UpdateGoalDeps = Readonly<{
  goalRepo: GoalRepository
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>
export type UpdateGoal = ReturnType<typeof updateGoal>

// ── Use case ────────────────────────────────────────────────────────────

export const updateGoal =
  (deps: UpdateGoalDeps) =>
  async (
    input: UpdateGoalInput,
    ctx: AuthContext,
  ): Promise<Result<Goal, UpdateGoalError>> => {
    // D6-001: PropertyManager/Staff must be assigned to the goal's property.
    const loaded = await loadAccessibleGoal(deps, input.goalId, ctx, 'goal.update')
    if (loaded.isErr()) {
      return err(loaded.error)
    }
    const goal = loaded.value

    // 2. Must be active
    if (goal.status !== 'active') {
      return err({ tag: 'goal_not_active', status: goal.status })
    }

    // 3. Validate targetValue if provided
    if (
      input.targetValue !== undefined &&
      (!Number.isFinite(input.targetValue) || input.targetValue <= 0)
    ) {
      return err({ tag: 'invalid_target_value' })
    }

    // 4. Build update data
    const now = deps.clock()
    const updates: {
      updatedAt: Date
      targetValue?: number
      recurrenceRule?: RecurrenceRule | null
    } = {
      updatedAt: now,
    }

    if (input.targetValue !== undefined) {
      updates.targetValue = input.targetValue
    }

    if (input.recurrenceRule !== undefined) {
      // Only recurring templates (not instances) can have recurrenceRule updated
      if (goal.goalType !== 'recurring' || goal.parentGoalId !== null) {
        return err({ tag: 'recurrence_rule_not_allowed' })
      }
      updates.recurrenceRule = input.recurrenceRule
    }

    // 5. Persist
    const updated = await deps.goalRepo.update(input.goalId, ctx.organizationId, updates)

    // Repo returns null if not found (shouldn't happen since we just checked)
    if (!updated) {
      return err({ tag: 'goal_not_found' })
    }

    return ok(updated)
  }
