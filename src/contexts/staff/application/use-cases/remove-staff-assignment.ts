// Staff context — remove staff assignment use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { StaffCommandStore } from '../ports/staff-command-store.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffAssignmentId } from '../../domain/types'
import { canForContext } from '#/shared/domain/permissions'
import { staffError } from '../../domain/errors'
import { staffUnassigned } from '../../domain/events'

// ── Input type ────────────────────────────────────────────────────────────

export type RemoveStaffAssignmentInput = Readonly<{
  assignmentId: StaffAssignmentId
}>

// fallow-ignore-next-line unused-type
export type RemoveStaffAssignmentDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  commandStore: StaffCommandStore
  clock: () => Date
}>

export const removeStaffAssignment =
  (deps: RemoveStaffAssignmentDeps) =>
  async (input: RemoveStaffAssignmentInput, ctx: AuthContext): Promise<void> => {
    // 1. Authorize
    if (!canForContext(ctx, 'staff_assignment.delete')) {
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

    // 3. Persist + fact — atomic via the command store (BQC-3.5)
    await deps.commandStore.unassignStaff({
      assignmentId: assignment.id,
      organizationId: ctx.organizationId,
      event: staffUnassigned({
        assignmentId: assignment.id,
        organizationId: assignment.organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        portalId: assignment.portalId,
        occurredAt: deps.clock(),
      }),
    })
  }

// fallow-ignore-next-line unused-type
export type RemoveStaffAssignment = ReturnType<typeof removeStaffAssignment>
