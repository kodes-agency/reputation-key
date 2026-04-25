// Staff context — domain constructors

import type { StaffAssignment, StaffAssignmentId } from './types'
import type { OrganizationId, PropertyId, TeamId, UserId } from '#/shared/domain/ids'

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
): StaffAssignment => ({
  id: input.id,
  organizationId: input.organizationId,
  userId: input.userId,
  propertyId: input.propertyId,
  teamId: input.teamId ?? null,
  createdAt: input.now,
  updatedAt: input.now,
  deletedAt: null,
})
