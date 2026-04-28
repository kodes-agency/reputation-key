// Staff context — domain constructors (smart constructors)
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."
// Pure — ID and time are inputs, no side effects.

import { Result } from 'neverthrow'
import type { StaffAssignment, StaffAssignmentId } from './types'
import type { StaffError } from './errors'
import type { OrganizationId, PropertyId, TeamId, UserId } from '#/shared/domain/ids'
import { validateNotSelfAssignment } from './rules'

export type BuildStaffAssignmentInput = Readonly<{
  id: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  teamId?: TeamId | null
  actingUserId: UserId
  now: Date
}>

export const buildStaffAssignment = (
  input: BuildStaffAssignmentInput,
): Result<StaffAssignment, StaffError> => {
  const selfAssignCheck = validateNotSelfAssignment(input.userId, input.actingUserId)

  return selfAssignCheck.map(
    (): StaffAssignment => ({
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      propertyId: input.propertyId,
      teamId: input.teamId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }),
  )
}
