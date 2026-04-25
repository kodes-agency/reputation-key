// Staff context — domain events

import type { StaffAssignmentId } from './types'
import type { OrganizationId, PropertyId, TeamId, UserId } from '#/shared/domain/ids'

export type StaffAssigned = Readonly<{
  _tag: 'staff.assigned'
  assignmentId: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  teamId: TeamId | null
  occurredAt: Date
}>

export type StaffUnassigned = Readonly<{
  _tag: 'staff.unassigned'
  assignmentId: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  occurredAt: Date
}>

export type StaffEvent = StaffAssigned | StaffUnassigned

export const staffAssigned = (args: Omit<StaffAssigned, '_tag'>): StaffAssigned => ({
  _tag: 'staff.assigned',
  ...args,
})

export const staffUnassigned = (
  args: Omit<StaffUnassigned, '_tag'>,
): StaffUnassigned => ({
  _tag: 'staff.unassigned',
  ...args,
})
