// Portal context — domain events
// Per architecture: "Events are facts, named in the past tense."
// Events live in their owning context's domain/events.ts.

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type { PortalId } from './types'
import type {
  OrganizationId,
  PortalGroupId,
  PortalLinkCategoryId,
  PortalLinkId,
  PropertyId,
} from '#/shared/domain/ids'
import { portalError } from './errors'

// ── Portal events ──────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalUpdated = Readonly<{
  _tag: 'portal.updated'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalDeleted = Readonly<{
  _tag: 'portal.deleted'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
}>

// ── Link category events ───────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type PortalLinkCategoryCreated = Readonly<{
  _tag: 'portal_link_category.created'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalLinkCategoryReordered = Readonly<{
  _tag: 'portal_link_category.reordered'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
}>

// ── Link events ────────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type PortalLinkCreated = Readonly<{
  _tag: 'portal_link.created'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalLinkReordered = Readonly<{
  _tag: 'portal_link.reordered'
  eventId: string
  correlationId: string | null
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  occurredAt: Date
}>

// ── Portal group events ───────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type PortalGroupCreated = Readonly<{
  _tag: 'portal_group.created'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalGroupUpdated = Readonly<{
  _tag: 'portal_group.updated'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalGroupDeleted = Readonly<{
  _tag: 'portal_group.deleted'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalAddedToGroup = Readonly<{
  _tag: 'portal_group.portal_added'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalRemovedFromGroup = Readonly<{
  _tag: 'portal_group.portal_removed'
  eventId: string
  correlationId: string | null
  portalGroupId: PortalGroupId
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
}>

// ── Event union ────────────────────────────────────────────────────

export type PortalEvent =
  | PortalCreated
  | PortalUpdated
  | PortalDeleted
  | PortalLinkCategoryCreated
  | PortalLinkCategoryReordered
  | PortalLinkCreated
  | PortalLinkReordered
  | PortalGroupCreated
  | PortalGroupUpdated
  | PortalGroupDeleted
  | PortalAddedToGroup
  | PortalRemovedFromGroup

// ── Event constructors ─────────────────────────────────────────────

export const portalCreated = (
  args: Omit<PortalCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  if (!args.slug || args.slug.trim().length === 0) {
    throw portalError('invalid_slug', 'slug must be a non-empty string')
  }
  return {
    _tag: 'portal.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalUpdated = (
  args: Omit<PortalUpdated, '_tag' | 'eventId' | 'correlationId'>,
): PortalUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  if (!args.slug || args.slug.trim().length === 0) {
    throw portalError('invalid_slug', 'slug must be a non-empty string')
  }
  return {
    _tag: 'portal.updated',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalDeleted = (
  args: Omit<PortalDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PortalDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.deleted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkCategoryCreated = (
  args: Omit<PortalLinkCategoryCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCategoryCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_link_category.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkCategoryReordered = (
  args: Omit<PortalLinkCategoryReordered, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCategoryReordered => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_link_category.reordered',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkCreated = (
  args: Omit<PortalLinkCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_link.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalLinkReordered = (
  args: Omit<PortalLinkReordered, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkReordered => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_link.reordered',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

// ── Portal group event constructors ────────────────────────────────

export const portalGroupCreated = (
  args: Omit<PortalGroupCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.created',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalGroupUpdated = (
  args: Omit<PortalGroupUpdated, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return {
    _tag: 'portal_group.updated',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalGroupDeleted = (
  args: Omit<PortalGroupDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_group.deleted',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalAddedToGroup = (
  args: Omit<PortalAddedToGroup, '_tag' | 'eventId' | 'correlationId'>,
): PortalAddedToGroup => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_group.portal_added',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}

export const portalRemovedFromGroup = (
  args: Omit<PortalRemovedFromGroup, '_tag' | 'eventId' | 'correlationId'>,
): PortalRemovedFromGroup => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal_group.portal_removed',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}
