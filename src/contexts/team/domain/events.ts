// Team context — domain events
// Standards: docs/standards.md §1

import assert from 'node:assert/strict'
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
  args: Omit<TeamCreated, '_tag' | 'eventId' | 'correlationId'>,
): TeamCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'team.created',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
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
  args: Omit<TeamUpdated, '_tag' | 'eventId' | 'correlationId'>,
): TeamUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'team.updated',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type TeamDeleted = Readonly<{
  _tag: 'team.deleted'
  eventId: string
  teamId: TeamId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const teamDeleted = (
  args: Omit<TeamDeleted, '_tag' | 'eventId' | 'correlationId'>,
): TeamDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'team.deleted',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type TeamEvent = TeamCreated | TeamUpdated | TeamDeleted
