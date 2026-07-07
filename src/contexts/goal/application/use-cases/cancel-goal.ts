// Goal context — cancel-goal use case
// Sets status to 'cancelled', cascades for recurring templates.
// Per architecture: "Dependencies are passed as function arguments."
//
// NOTE(F030): This use case does NOT emit a domain event (e.g. goal.cancelled).
// Goal cancellation is a management action with no downstream consumers yet.
// If event-driven reactions to cancellation are needed, add a goalCancelled event.

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { ok, err, type Result } from '#/shared/domain'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPropertyAccessible } from '#/shared/domain/property-access'

// ── Input type ──────────────────────────────────────────────────────────

export type CancelGoalInput = Readonly<{
  goalId: GoalId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

// ── Error types ─────────────────────────────────────────────────────────

export type CancelGoalError =
  | { tag: 'forbidden' }
  | { tag: 'goal_not_found' }
  | { tag: 'goal_not_active'; status: string }

// ── Deps ────────────────────────────────────────────────────────────────

export type CancelGoalDeps = Readonly<{
  goalRepo: GoalRepository
  staffPublicApi: StaffPublicApi
  clock: () => Date
}>
export type CancelGoal = ReturnType<typeof cancelGoal>

// ── Use case ────────────────────────────────────────────────────────────

export const cancelGoal =
  (deps: CancelGoalDeps) =>
  async (input: CancelGoalInput): Promise<Result<Goal, CancelGoalError>> => {
    if (!can(input.role, 'goal.cancel')) {
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

    const now = deps.clock()

    // 3. Cancel instances + parent atomically for recurring templates (GOAL-03)
    if (goal.goalType === 'recurring' && goal.parentGoalId === null) {
      const updated = await deps.goalRepo.cancelTemplateAndInstances(
        goal.id,
        input.organizationId,
        now,
      )
      if (!updated) {
        return err({ tag: 'goal_not_found' })
      }
      return ok(updated)
    }

    // 4. Non-recurring: just update status to cancelled
    const updated = await deps.goalRepo.update(input.goalId, input.organizationId, {
      status: 'cancelled',
      updatedAt: now,
    })

    if (!updated) {
      return err({ tag: 'goal_not_found' })
    }

    return ok(updated)
  }
