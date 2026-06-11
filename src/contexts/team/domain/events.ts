// Team context — domain events
// Standards: docs/standards.md §1

import type { TeamId } from './types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { teamError } from './errors'

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
  args: Omit<TeamCreated, '_tag' | 'correlationId'>,
): TeamCreated => {
  if (!(args.occurredAt instanceof Date))
    throw teamError('invalid_name', 'occurredAt must be Date')
  return {
    _tag: 'team.created',
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
  args: Omit<TeamUpdated, '_tag' | 'correlationId'>,
): TeamUpdated => {
  if (!(args.occurredAt instanceof Date))
    throw teamError('invalid_name', 'occurredAt must be Date')
  return {
    _tag: 'team.updated',
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
  args: Omit<TeamDeleted, '_tag' | 'correlationId'>,
): TeamDeleted => {
  if (!(args.occurredAt instanceof Date))
    throw teamError('invalid_name', 'occurredAt must be Date')
  return {
    _tag: 'team.deleted',
    correlationId: null,
    ...args,
  }
}

export type TeamEvent = TeamCreated | TeamUpdated | TeamDeleted
