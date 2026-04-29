// Team context — domain events
// Per architecture: "Events are facts, named in the past tense."

import type { TeamId } from './types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type TeamCreated = Readonly<{
  _tag: 'team.created'
  teamId: TeamId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type TeamUpdated = Readonly<{
  _tag: 'team.updated'
  teamId: TeamId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type TeamDeleted = Readonly<{
  _tag: 'team.deleted'
  teamId: TeamId
  organizationId: OrganizationId
  occurredAt: Date
}>

export type TeamEvent = TeamCreated | TeamUpdated | TeamDeleted

// ── Event constructors ──────────────────────────────────────────────

export const teamCreated = (args: Omit<TeamCreated, '_tag'>): TeamCreated => ({
  _tag: 'team.created',
  ...args,
})

export const teamUpdated = (args: Omit<TeamUpdated, '_tag'>): TeamUpdated => ({
  _tag: 'team.updated',
  ...args,
})

export const teamDeleted = (args: Omit<TeamDeleted, '_tag'>): TeamDeleted => ({
  _tag: 'team.deleted',
  ...args,
})
