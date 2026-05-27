// Staff context — domain constructors (smart constructors)
// Per architecture: "Build domain entities from raw input, composing all validations,
// returning a Result."
// Pure — ID and time are inputs, no side effects.

import { ok, err, type Result } from 'neverthrow'
import type { StaffAssignment, StaffAssignmentId } from './types'
import type { StaffError } from './errors'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  TeamId,
  UserId,
} from '#/shared/domain/ids'
import { validateNotSelfAssignment } from './rules'

// fallow-ignore-next-line unused-type
export type BuildStaffAssignmentInput = Readonly<{
  id: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  teamId?: TeamId | null
  portalId?: PortalId | null
  actingUserId?: UserId
  now: Date
}>

export const buildStaffAssignment = (
  input: BuildStaffAssignmentInput,
): Result<StaffAssignment, StaffError> => {
  // Self-assignment guard — enforced by domain constructor
  if (input.actingUserId) {
    const guard = validateNotSelfAssignment(input.userId, input.actingUserId)
    if (guard.isErr()) {
      return err(guard.error)
    }
  }

  return ok({
    id: input.id,
    organizationId: input.organizationId,
    userId: input.userId,
    propertyId: input.propertyId,
    teamId: input.teamId ?? null,
    portalId: input.portalId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
  })
}
