// Goal context — update-goal use case
// Updates targetValue and/or recurrenceRule on an active goal.
// Per architecture: "Dependencies are passed as function arguments."

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal, RecurrenceRule } from '../../domain/types'
import type { GoalId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { ok, err, type Result } from '#/shared/domain'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessible } from '#/shared/domain/property-access'

// ── Input type ──────────────────────────────────────────────────────────

export type UpdateGoalInput = Readonly<{
  goalId: GoalId
  organizationId: OrganizationId
  userId: UserId
  targetValue?: number
  recurrenceRule?: RecurrenceRule | null
  role: Role
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
  async (input: UpdateGoalInput): Promise<Result<Goal, UpdateGoalError>> => {
    if (!can(input.role, 'goal.update')) {
      return err({ tag: 'forbidden' })
    }

    // 1. Load goal
    const goal = await deps.goalRepo.getById(input.goalId, input.organizationId)
    if (!goal) {
      return err({ tag: 'goal_not_found' })
    }

    // D6-001: PropertyManager/Staff must be assigned to the goal's property.
    const accessible = await isPropertyAccessible(
      (orgId, uId, orgWide) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
      input.organizationId,
      input.userId,
      input.role === 'AccountAdmin',
      goal.propertyId,
    )
    if (!accessible) {
      return err({ tag: 'forbidden' })
    }

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
    const updated = await deps.goalRepo.update(
      input.goalId,
      input.organizationId,
      updates,
    )

    // Repo returns null if not found (shouldn't happen since we just checked)
    if (!updated) {
      return err({ tag: 'goal_not_found' })
    }

    return ok(updated)
  }
