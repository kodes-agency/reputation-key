// Goal context — cancel-goal use case
// Sets status to 'cancelled', cascades for recurring templates.
// Per architecture: "Dependencies are passed as function arguments."

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import { can } from '#/shared/domain/permissions'
import { ok, err, type Result } from 'neverthrow'

// ── Input type ──────────────────────────────────────────────────────────

type CancelGoalInput = Readonly<{
  goalId: GoalId
  organizationId: OrganizationId
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

    // 2. Must be active
    if (goal.status !== 'active') {
      return err({ tag: 'goal_not_active', status: goal.status })
    }

    const now = deps.clock()

    // 3. Cascade to instances for recurring templates
    // TODO(review/G0-11): Wrap cancelByParent + update in a transaction.
    // Current implementation could leave instances cancelled but parent active on partial failure.
    if (goal.goalType === 'recurring' && goal.parentGoalId === null) {
      await deps.goalRepo.cancelByParent(goal.id, input.organizationId, now)
    }

    // 4. Update status to cancelled
    const updated = await deps.goalRepo.update(input.goalId, input.organizationId, {
      status: 'cancelled',
      updatedAt: now,
    })

    if (!updated) {
      return err({ tag: 'goal_not_found' })
    }

    return ok(updated)
  }
