// Goal context — StaffUnassigned event handler
// Cancels active goals scoped to the unassigned staff member.
// Per architecture: event handler subscribes via EventBus, drives use case.

import type { StaffUnassigned } from '#/contexts/staff/application/public-api'
import type { GoalRepository } from '../../application/ports/goal.repository'
import type { Goal } from '../../domain/types'
import type { GoalId, OrganizationId } from '#/shared/domain/ids'
import { staffId } from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { Result } from 'neverthrow'
import type { getLogger as getLoggerType } from '#/shared/observability/logger'

// ── Dependencies ──────────────────────────────────────────────────────

export type OnStaffUnassignedDeps = Readonly<{
  goalRepo: GoalRepository
  cancelGoalFn: (
    input: Readonly<{ goalId: GoalId; organizationId: OrganizationId; role: Role }>,
  ) => Promise<Result<Goal, unknown>>
  getLogger: typeof getLoggerType
}>

// ── Handler factory ───────────────────────────────────────────────────

export const onStaffUnassigned =
  (deps: OnStaffUnassignedDeps) =>
  async (event: StaffUnassigned): Promise<void> => {
    // StaffUnassigned.assignmentId is StaffAssignmentId.
    // In the goal context, staff-scoped goals use the assignment ID as the staff key.
    // Map via staffId() constructor to preserve brand safety at the boundary.
    const goals = await deps.goalRepo.list({
      organizationId: event.organizationId,
      staffId: staffId(event.assignmentId),
      status: 'active',
    })

    for (const goal of goals) {
      const result = await deps.cancelGoalFn({
        goalId: goal.id,
        organizationId: event.organizationId,
        role: 'AccountAdmin',
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
