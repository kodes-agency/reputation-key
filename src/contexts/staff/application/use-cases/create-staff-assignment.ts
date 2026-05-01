// Staff context — create staff assignment use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffAssignment, StaffAssignmentId } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreateStaffAssignmentInput } from '../dto/staff-assignment.dto'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import { buildStaffAssignment } from '../../domain/constructors'
import { staffError } from '../../domain/errors'
import { staffAssigned } from '../../domain/events'
import {
  userId as toUserId,
  propertyId as toPropertyId,
  teamId as toTeamId,
} from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type CreateStaffAssignmentDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  events: EventBus
  idGen: () => StaffAssignmentId
  clock: () => Date
}>

export const createStaffAssignment =
  (deps: CreateStaffAssignmentDeps) =>
  async (
    input: CreateStaffAssignmentInput,
    ctx: AuthContext,
  ): Promise<StaffAssignment> => {
    // 1. Authorize
    if (!can(ctx.role, 'staff_assignment.create')) {
      throw staffError('forbidden', 'this role cannot manage staff assignments')
    }

    const userId = toUserId(input.userId)
    const propertyId = toPropertyId(input.propertyId)
    const teamId = input.teamId != null ? toTeamId(input.teamId) : null

    // 2. Self-assignment guard — only Staff role is blocked
    if (userId === ctx.userId && !hasRole(ctx.role, 'PropertyManager')) {
      throw staffError('invalid_input', 'Cannot assign yourself to a property')
    }

    // 3. Check uniqueness — prevent duplicate assignments
    if (
      await deps.assignmentRepo.assignmentExists(
        ctx.organizationId,
        userId,
        propertyId,
        teamId,
      )
    ) {
      throw staffError(
        'already_assigned',
        'this user is already assigned to this property/team',
      )
    }

    // 4. Build domain object
    const buildResult = buildStaffAssignment({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      userId,
      propertyId,
      teamId,
      now: deps.clock(),
    })

    if (buildResult.isErr()) {
      throw staffError(buildResult.error.code, buildResult.error.message)
    }

    const assignment = buildResult.value

    // 5. Persist
    await deps.assignmentRepo.insert(ctx.organizationId, assignment)

    // 6. Emit event
    deps.events.emit(
      staffAssigned({
        assignmentId: assignment.id,
        organizationId: assignment.organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        teamId: assignment.teamId,
        occurredAt: assignment.createdAt,
      }),
    )

    // 7. Return
    return assignment
  }

// fallow-ignore-next-line unused-type
export type CreateStaffAssignment = ReturnType<typeof createStaffAssignment>
