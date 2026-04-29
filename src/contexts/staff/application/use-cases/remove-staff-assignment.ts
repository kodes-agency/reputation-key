// Staff context — remove staff assignment use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffAssignmentId } from '../../domain/types'
import { can } from '#/shared/domain/permissions'
import { staffError } from '../../domain/errors'
import { staffUnassigned } from '../../domain/events'

// fallow-ignore-next-line unused-type
export type RemoveStaffAssignmentDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  events: EventBus
  clock: () => Date
}>

export const removeStaffAssignment =
  (deps: RemoveStaffAssignmentDeps) =>
  async (input: { assignmentId: StaffAssignmentId }, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!can(ctx.role, 'staff_assignment.delete')) {
      throw staffError('forbidden', 'this role cannot manage staff assignments')
    }

    // 2. Load existing
    const assignment = await deps.assignmentRepo.findById(
      ctx.organizationId,
      input.assignmentId,
    )
    if (!assignment) {
      throw staffError('assignment_not_found', 'assignment not found')
    }

    // 5. Persist
    await deps.assignmentRepo.softDelete(ctx.organizationId, assignment.id)

    // 6. Emit event
    deps.events.emit(
      staffUnassigned({
        assignmentId: assignment.id,
        organizationId: assignment.organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        occurredAt: deps.clock(),
      }),
    )
  }

// fallow-ignore-next-line unused-type
export type RemoveStaffAssignment = ReturnType<typeof removeStaffAssignment>
