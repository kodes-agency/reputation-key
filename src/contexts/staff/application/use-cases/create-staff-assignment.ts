// Staff context — create staff assignment use case

import type { StaffAssignmentRepository } from '../ports/staff-assignment.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffAssignment } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { CreateStaffAssignmentInput } from '../dto/staff-assignment.dto'
export type { CreateStaffAssignmentInput } from '../dto/staff-assignment.dto'
import type { StaffPublicApi } from '../public-api'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import { buildStaffAssignment } from '../../domain/constructors'
import { staffError } from '../../domain/errors'
import { staffAssigned } from '../../domain/events'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import {
  userId as toUserId,
  propertyId as toPropertyId,
  teamId as toTeamId,
  portalId as toPortalId,
  staffAssignmentId,
} from '#/shared/domain/ids'

export type CreateStaffAssignmentDeps = Readonly<{
  assignmentRepo: StaffAssignmentRepository
  events: EventBus
  staffPublicApi: StaffPublicApi
  idGen: () => string
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
    const portalId = input.portalId != null ? toPortalId(input.portalId) : null

    // 2. Property-access scoping (D6-001):
    // AccountAdmin bypasses (getAccessiblePropertyIds returns null = all-accessible);
    // PropertyManager/Staff must be assigned to the target property.
    const accessible = await isPropertyAccessible(
      (orgId, uId, role) =>
        deps.staffPublicApi.getAccessiblePropertyIds(orgId, uId, role),
      ctx.organizationId,
      ctx.userId,
      ctx.role,
      propertyId,
    )
    if (!accessible) {
      throw staffError('forbidden', 'no access to this property')
    }

    // 3. Self-assignment guard delegated to constructor (STAFF-01):
    // Only AccountAdmin may self-assign; PropertyManager/Staff cannot.
    const actingUserId = hasRole(ctx.role, 'AccountAdmin') ? undefined : ctx.userId

    // 4. Check uniqueness — prevent duplicate assignments
    if (
      await deps.assignmentRepo.assignmentExists(
        ctx.organizationId,
        userId,
        propertyId,
        teamId,
        portalId,
      )
    ) {
      throw staffError(
        'already_assigned',
        'this user is already assigned to this property/team/portal',
      )
    }

    // 5. Build domain object
    const buildResult = buildStaffAssignment({
      id: staffAssignmentId(deps.idGen()),
      organizationId: ctx.organizationId,
      userId,
      propertyId,
      teamId,
      portalId,
      actingUserId,
      now: deps.clock(),
    })

    if (buildResult.isErr()) {
      throw staffError(buildResult.error.code, buildResult.error.message)
    }

    const assignment = buildResult.value

    // 6. Persist
    await deps.assignmentRepo.insert(ctx.organizationId, assignment)

    // 7. Emit event
    await deps.events.emit(
      staffAssigned({
        assignmentId: assignment.id,
        organizationId: assignment.organizationId,
        userId: assignment.userId,
        propertyId: assignment.propertyId,
        teamId: assignment.teamId,
        portalId: assignment.portalId,
        occurredAt: assignment.createdAt,
      }),
    )

    // 8. Return
    return assignment
  }

// fallow-ignore-next-line unused-type
export type CreateStaffAssignment = ReturnType<typeof createStaffAssignment>
