// Portal context — domain events
// Standards: docs/standards.md §1

import type { PortalId } from './types'
import type {
  OrganizationId,
  PortalLinkCategoryId,
  PortalLinkId,
  PortalGroupId,
  PropertyId,
} from '#/shared/domain/ids'

export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
  correlationId: string | null
}>
export const portalCreated = (
  args: Omit<PortalCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.created',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalUpdated = Readonly<{
  _tag: 'portal.updated'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
  correlationId: string | null
}>
export const portalUpdated = (
  args: Omit<PortalUpdated, '_tag' | 'eventId' | 'correlationId'>,
): PortalUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.updated',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalDeleted = Readonly<{
  _tag: 'portal.deleted'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const portalDeleted = (
  args: Omit<PortalDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PortalDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.deleted',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

export type PortalLinkCategoryCreated = Readonly<{
  _tag: 'portal.portal_link_category.created'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const portalLinkCategoryCreated = (
  args: Omit<PortalLinkCategoryCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCategoryCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.portal_link_category.created',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalLinkCategoryReordered = Readonly<{
  _tag: 'portal.portal_link_category.reordered'
  eventId: string
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const portalLinkCategoryReordered = (
  args: Omit<PortalLinkCategoryReordered, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCategoryReordered => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.portal_link_category.reordered',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalLinkCreated = Readonly<{
  _tag: 'portal.portal_link.created'
  eventId: string
  portalId: PortalId
  linkId: PortalLinkId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const portalLinkCreated = (
  args: Omit<PortalLinkCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.portal_link.created',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalLinkReordered = Readonly<{
  _tag: 'portal.portal_link.reordered'
  eventId: string
  portalId: PortalId
  categoryId: PortalLinkCategoryId
  organizationId: OrganizationId
  occurredAt: Date
  correlationId: string | null
}>
export const portalLinkReordered = (
  args: Omit<PortalLinkReordered, '_tag' | 'eventId' | 'correlationId'>,
): PortalLinkReordered => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.portal_link.reordered',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalGroupCreated = Readonly<{
  _tag: 'portal.portal_group.created'
  eventId: string
  groupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
  correlationId: string | null
}>
export const portalGroupCreated = (
  args: Omit<PortalGroupCreated, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.portal_group.created',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalGroupUpdated = Readonly<{
  _tag: 'portal.portal_group.updated'
  eventId: string
  groupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
  correlationId: string | null
}>
export const portalGroupUpdated = (
  args: Omit<PortalGroupUpdated, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.portal_group.updated',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}
export type PortalGroupDeleted = Readonly<{
  _tag: 'portal.portal_group.deleted'
  eventId: string
  groupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>
export const portalGroupDeleted = (
  args: Omit<PortalGroupDeleted, '_tag' | 'eventId' | 'correlationId'>,
): PortalGroupDeleted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be Date')
  return {
    _tag: 'portal.portal_group.deleted',
    eventId: crypto.randomUUID(),
    correlationId: null,
    ...args,
  }
}

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
