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
  propertyId: PropertyId
  userId: UserId
  teamId: TeamId | null
  portalId: PortalId | null
  occurredAt: Date
  correlationId: string | null
}>
export const staffAssigned = (
  args: Omit<StaffAssigned, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): StaffAssigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    ...args,
    _tag: 'staff.assigned',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type StaffUnassigned = Readonly<{
  _tag: 'staff.unassigned'
  eventId: string
  assignmentId: StaffAssignmentId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  portalId: PortalId | null
  occurredAt: Date
  correlationId: string | null
}>
export const staffUnassigned = (
  args: Omit<StaffUnassigned, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): StaffUnassigned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    ...args,
    _tag: 'staff.unassigned',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type StaffEvent = StaffAssigned | StaffUnassigned
