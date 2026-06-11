// Staff context — domain events
// Standards: docs/standards.md §1

import type { StaffAssignmentId } from './types'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  TeamId,
  UserId,
} from '#/shared/domain/ids'
import { staffError } from './errors'

export type StaffAssigned = Readonly<{
  _tag: 'staff.assigned'
  eventId: string
  assignmentId: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  teamId: TeamId | null
  portalId: PortalId | null
  occurredAt: Date
  correlationId: string | null
}>
export const staffAssigned = (
  args: Omit<StaffAssigned, '_tag' | 'correlationId'>,
): StaffAssigned => {
  if (!(args.occurredAt instanceof Date))
    throw staffError('invalid_input', 'occurredAt must be Date')
  return {
    _tag: 'staff.assigned',
    correlationId: null,
    ...args,
  }
}

export type StaffUnassigned = Readonly<{
  _tag: 'staff.unassigned'
  eventId: string
  assignmentId: StaffAssignmentId
  organizationId: OrganizationId
  userId: UserId
  propertyId: PropertyId
  portalId: PortalId | null
  occurredAt: Date
  correlationId: string | null
}>
export const staffUnassigned = (
  args: Omit<StaffUnassigned, '_tag' | 'correlationId'>,
): StaffUnassigned => {
  if (!(args.occurredAt instanceof Date))
    throw staffError('invalid_input', 'occurredAt must be Date')
  return {
    _tag: 'staff.unassigned',
    correlationId: null,
    ...args,
  }
}

export type StaffEvent = StaffAssigned | StaffUnassigned
