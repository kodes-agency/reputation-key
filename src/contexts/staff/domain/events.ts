// Staff context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { StaffAssignmentId } from './types'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  TeamId,
  UserId,
} from '#/shared/domain/ids'

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
  args: Omit<StaffAssigned, '_tag' | 'eventId' | 'correlationId'>,
): StaffAssigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'staff.assigned',
    eventId: newEventId(),
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
  args: Omit<StaffUnassigned, '_tag' | 'eventId' | 'correlationId'>,
): StaffUnassigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'staff.unassigned',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export type StaffEvent = StaffAssigned | StaffUnassigned
