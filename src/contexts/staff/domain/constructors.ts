// Staff context — domain constructors (smart constructors)
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."
// Pure — ID and time are inputs, no side effects.

import { ok, Result } from 'neverthrow'
import type { StaffAssignment, StaffAssignmentId } from './types'
import type { StaffError } from './errors'
import type { OrganizationId, PropertyId, TeamId, UserId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type BuildStaffAssignmentInput = Readonly<{
  id: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  teamId?: TeamId | null
  now: Date
}>

export const buildStaffAssignment = (
  input: BuildStaffAssignmentInput,
): Result<StaffAssignment, StaffError> => {
  return ok({
    id: input.id,
    organizationId: input.organizationId,
    userId: input.userId,
    propertyId: input.propertyId,
    teamId: input.teamId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  })
}
