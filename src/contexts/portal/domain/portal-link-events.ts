// Portal context — link and link-category domain events.
// Split out of events.ts (round 4 F3) so new link facts do not grow a ratcheted
// file. events.ts re-exports every name unchanged; importers do not move.

import { newEventId } from '#/shared/domain/event-id'
import type {
  OrganizationId,
  PortalLinkCategoryId,
  PortalLinkId,
  PropertyId,
} from '#/shared/domain/ids'
import type { PortalId } from './types'
import { assertPortalLifecycleFact, type PortalEventArgs } from './portal-event-base'

// ── Link category events ───────────────────────────────────────────

export type PortalLinkCategoryCreated = Readonly<{
  _tag: 'portal_link_category.created'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkCategoryReordered = Readonly<{
  _tag: 'portal_link_category.reordered'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkCategoryUpdated = Readonly<{
  _tag: 'portal_link_category.updated'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkCategoryDeleted = Readonly<{
  _tag: 'portal_link_category.deleted'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

// ── Link events ────────────────────────────────────────────────────

export type PortalLinkCreated = Readonly<{
  _tag: 'portal_link.created'
  eventId: string
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkReordered = Readonly<{
  _tag: 'portal_link.reordered'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkUpdated = Readonly<{
  _tag: 'portal_link.updated'
  eventId: string
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export type PortalLinkDeleted = Readonly<{
  _tag: 'portal_link.deleted'
  eventId: string
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export const portalLinkCategoryCreated = (
  args: PortalEventArgs<PortalLinkCategoryCreated>,
): PortalLinkCategoryCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCategoryReordered = (
  args: PortalEventArgs<PortalLinkCategoryReordered>,
): PortalLinkCategoryReordered => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.reordered',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCategoryUpdated = (
  args: PortalEventArgs<PortalLinkCategoryUpdated>,
): PortalLinkCategoryUpdated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCategoryDeleted = (
  args: PortalEventArgs<PortalLinkCategoryDeleted>,
): PortalLinkCategoryDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link_category.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkCreated = (
  args: PortalEventArgs<PortalLinkCreated>,
): PortalLinkCreated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.created',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkReordered = (
  args: PortalEventArgs<PortalLinkReordered>,
): PortalLinkReordered => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.reordered',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkUpdated = (
  args: PortalEventArgs<PortalLinkUpdated>,
): PortalLinkUpdated => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.updated',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}

export const portalLinkDeleted = (
  args: PortalEventArgs<PortalLinkDeleted>,
): PortalLinkDeleted => {
  assertPortalLifecycleFact(args)
  return {
    _tag: 'portal_link.deleted',
    eventId: newEventId(),
    ...args,
    correlationId: args.correlationId ?? null,
  }
}
