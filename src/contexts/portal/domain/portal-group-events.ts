// Portal context — portal group domain events.
// Split out of events.ts (round 4 F3) so new group facts do not grow a ratcheted
// file. events.ts re-exports every name unchanged; importers do not move.

import { newEventId } from '#/shared/domain/event-id'
import type { OrganizationId, PortalGroupId, PropertyId } from '#/shared/domain/ids'
import type { PortalId } from './types'
import { portalError } from './errors'
import { assertPortalLifecycleFact, type PortalEventArgs } from './portal-event-base'

// ── Portal group events ───────────────────────────────────────────

export type PortalGroupCreated = Readonly<{
  _tag: 'portal_group.created'
  eventId: string
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalGroupUpdated = Readonly<{
  _tag: 'portal_group.updated'
  eventId: string
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalGroupDeleted = Readonly<{
  _tag: 'portal_group.deleted'
  eventId: string
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalAddedToGroup = Readonly<{
  _tag: 'portal_group.portal_added'
  eventId: string
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalRemovedFromGroup = Readonly<{
  _tag: 'portal_group.portal_removed'
  eventId: string
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

// ── Portal group event constructors ────────────────────────────────

export const portalGroupCreated = (
  args: PortalEventArgs<PortalGroupCreated>,
): PortalGroupCreated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalGroupUpdated = (
  args: PortalEventArgs<PortalGroupUpdated>,
): PortalGroupUpdated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalGroupDeleted = (
  args: PortalEventArgs<PortalGroupDeleted>,
): PortalGroupDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalAddedToGroup = (
  args: PortalEventArgs<PortalAddedToGroup>,
): PortalAddedToGroup => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.portal_added',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalRemovedFromGroup = (
  args: PortalEventArgs<PortalRemovedFromGroup>,
): PortalRemovedFromGroup => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_group.portal_removed',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}
