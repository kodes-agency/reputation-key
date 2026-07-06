// Goal context — system cancel-goal use case
// Cancels a goal as a system action (e.g. portal/portal-group deletion cascade).
//
// Deliberately skips the `can()` permission gate and the property-access
// self-assignment guard: system actions are not impersonating a staff member,
// and masquerading as 'AccountAdmin' with userId('system') is invisible in the
// audit trail. Instead this entry carries an explicit `reason` tag so the
// cancellation origin is observable.
//
// Keeps the domain invariant that only `active` goals can be cancelled.
// Per architecture: "Dependencies are passed as function arguments."

import type { GoalRepository } from '../ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import { ok, err, type Result } from '#/shared/domain'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'

// ── Input type ────────────────────────────────────────────────────────

/**
 * Tagged reason for a system-initiated cancellation.
 * Serves as the audit marker — recorded on the log so the cancellation
 * origin is observable without a human initiator.
 */
export type SystemCancelReason = 'portal_deleted' | 'portal_group_deleted'

export type SystemCancelGoalInput = Readonly<{
  goalId: GoalId
  organizationId: OrganizationId
  reason: SystemCancelReason
}>

// ── Error types ──────────────────────────────────────────────────────

export type SystemCancelGoalError =
  | { tag: 'goal_not_found' }
  | { tag: 'goal_not_active'; status: string }

// ── Dependencies ─────────────────────────────────────────────────────

export type SystemCancelGoalDeps = Readonly<{
  goalRepo: GoalRepository
  clock: () => Date
  getLogger: typeof getLoggerType
}>

/**
 * Use-case type: system-initiated goal cancellation.
 * (Named concrete type — not `ReturnType<typeof ...>`.)
 */
export type SystemCancelGoal = (
  input: SystemCancelGoalInput,
) => Promise<Result<Goal, SystemCancelGoalError>>

// ── Use case ─────────────────────────────────────────────────────────

export const systemCancelGoal =
  (deps: SystemCancelGoalDeps): SystemCancelGoal =>
  async (input) => {
    // 1. Load goal (tenant-scoped)
    const goal = await deps.goalRepo.getById(input.goalId, input.organizationId)
    if (!goal) {
      return err({ tag: 'goal_not_found' })
    }

    // 2. Domain invariant: only active goals can be cancelled
    if (goal.status !== 'active') {
      return err({ tag: 'goal_not_active', status: goal.status })
    }

    // Audit marker — system cancellation has no human initiator, so the
    // typed `reason` tag is the record of origin.
    deps.getLogger().info(
      {
        goalId: goal.id,
        organizationId: input.organizationId,
        reason: input.reason,
        goalType: goal.goalType,
      },
      'goal: system-initiated cancellation',
    )

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
