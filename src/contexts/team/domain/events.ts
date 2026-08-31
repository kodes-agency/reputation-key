// Team context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { TeamId } from './types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type TeamCreated = Readonly<{
  _tag: 'team.created'
  eventId: string
  teamId: TeamId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
  correlationId: string | null
}>
export const teamCreated = (
  args: Omit<TeamCreated, '_tag' | 'eventId' | 'correlationId'> &
    Readonly<{ correlationId?: string | null }>,
): TeamCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    _tag: 'team.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type TeamUpdated = Readonly<{
  _tag: 'team.updated'
  eventId: string
  teamId: TeamId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
  correlationId: string | null
}>
export const teamUpdated = (
  args: Omit<TeamUpdated, '_tag' | 'eventId' | 'correlationId'> &
    Readonly<{ correlationId?: string | null }>,
): TeamUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    _tag: 'team.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type TeamDeleted = Readonly<{
  _tag: 'team.deleted'
  eventId: string
  teamId: TeamId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>
export const teamDeleted = (
  args: Omit<TeamDeleted, '_tag' | 'eventId' | 'correlationId'> &
    Readonly<{ correlationId?: string | null }>,
): TeamDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    _tag: 'team.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export type TeamEvent = TeamCreated | TeamUpdated | TeamDeleted
