// Goal context — StaffUnassigned event handler
// Cancels active goals scoped to the unassigned staff member.
// Per architecture: event handler subscribes via EventBus, drives use case.

import type { StaffUnassigned } from '#/contexts/staff/application/public-api'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId, StaffId } from '#/shared/domain/ids'
import type { Result } from 'neverthrow'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnStaffUnassignedDeps = Readonly<{
  goalRepo: GoalRepository
  cancelGoalFn: (
    input: Readonly<{ goalId: GoalId; organizationId: OrganizationId }>,
  ) => Promise<Result<Goal, unknown>>
  getLogger: typeof getLoggerType
}>

// ── Handler factory ───────────────────────────────────────────────────

export const onStaffUnassigned =
  (deps: OnStaffUnassignedDeps) =>
  async (event: StaffUnassigned): Promise<void> => {
    // StaffUnassigned.assignmentId is StaffAssignmentId which is the staffId used in goal scoping
    const goals = await deps.goalRepo.list({
      organizationId: event.organizationId,
      staffId: event.assignmentId as unknown as StaffId,
      status: 'active',
    })

    for (const goal of goals) {
      const result = await deps.cancelGoalFn({
        goalId: goal.id,
        organizationId: event.organizationId,
      })
      if (result.isErr()) {
        deps
          .getLogger()
          .error(
            { err: result.error, goalId: goal.id },
            'goal: failed to cancel on staff unassigned',
          )
      }
    }
  }
