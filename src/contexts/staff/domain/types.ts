// Staff context — domain types
// Staff assignments link users to properties (directly or via a team).
// Per architecture: types are data only — no methods, no classes.

import type {
  OrganizationId,
  PropertyId,
  StaffAssignmentId,
  TeamId,
  UserId,
} from '#/shared/domain/ids'

/** Staff assignment — links a user to a property, optionally via a team. */
export type StaffAssignment = Readonly<{
  id: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  teamId: TeamId | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}>

/** Re-export StaffAssignmentId from shared for convenience */
export type { StaffAssignmentId } from '#/shared/domain/ids'
