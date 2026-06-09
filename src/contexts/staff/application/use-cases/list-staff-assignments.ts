// Staff context — list staff assignments use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { StaffAssignment } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { PropertyId, TeamId, UserId } from '#/shared/domain/ids'
import { staffError } from '../../domain/errors'
import { can } from '#/shared/domain/permissions'

// ── Input type ────────────────────────────────────────────────────────────

export type ListStaffAssignmentsInput = Readonly<{
  propertyId?: PropertyId
  userId?: UserId
  teamId?: TeamId
}>

// fallow-ignore-next-line unused-type
export type ListStaffAssignmentsDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
}>

export const listStaffAssignments =
  (deps: ListStaffAssignmentsDeps) =>
  async (
    input: ListStaffAssignmentsInput,
    ctx: AuthContext,
  ): Promise<ReadonlyArray<StaffAssignment>> => {
    if (!can(ctx.role, 'staff_assignment.read')) {
      throw staffError('forbidden', 'No staff assignment read permission')
    }
    if (input.teamId) {
      return deps.assignmentRepo.listByTeam(ctx.organizationId, input.teamId)
    }
    if (input.propertyId) {
      return deps.assignmentRepo.listByProperty(ctx.organizationId, input.propertyId)
    }
    if (input.userId) {
      return deps.assignmentRepo.listByUser(ctx.organizationId, input.userId)
    }
    // Return empty if no filter specified — caller must provide at least one
    return []
  }

// fallow-ignore-next-line unused-type
export type ListStaffAssignments = ReturnType<typeof listStaffAssignments>
