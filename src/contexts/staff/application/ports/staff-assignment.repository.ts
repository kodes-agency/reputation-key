// Staff context — repository port

import type { StaffAssignment, StaffAssignmentId } from '../../domain/types'
import type { OrganizationId, PropertyId, TeamId, UserId } from '#/shared/domain/ids'

export type StaffAssignmentRepository = Readonly<{
  findById: (
    orgId: OrganizationId,
    id: StaffAssignmentId,
  ) => Promise<StaffAssignment | null>
  listByUser: (
    orgId: OrganizationId,
    userId: UserId,
  ) => Promise<ReadonlyArray<StaffAssignment>>
  listByProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<StaffAssignment>>
  listByTeam: (
    orgId: OrganizationId,
    teamId: TeamId,
  ) => Promise<ReadonlyArray<StaffAssignment>>
  assignmentExists: (
    orgId: OrganizationId,
    userId: UserId,
    propertyId: PropertyId,
    teamId: TeamId | null,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, assignment: StaffAssignment) => Promise<void>
  softDelete: (orgId: OrganizationId, id: StaffAssignmentId) => Promise<void>
  /** Get all unique property IDs a user is assigned to (directly or via teams). */
  getAccessiblePropertyIds: (
    orgId: OrganizationId,
    userId: UserId,
  ) => Promise<ReadonlyArray<PropertyId>>
}>
