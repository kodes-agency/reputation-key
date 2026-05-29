// Portal context — PortalGroup domain events
import type { OrganizationId, PortalGroupId, PropertyId } from '#/shared/domain/ids'

export type PortalGroupCreated = Readonly<{
  _tag: 'portal_group.created'
  groupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
}>

export type PortalGroupUpdated = Readonly<{
  _tag: 'portal_group.updated'
  groupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  occurredAt: Date
}>

export type PortalGroupDeleted = Readonly<{
  _tag: 'portal_group.deleted'
  groupId: PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
}>

export type PortalGroupEvent =
  | PortalGroupCreated
  | PortalGroupUpdated
  | PortalGroupDeleted

export const portalGroupCreated = (
  args: Omit<PortalGroupCreated, '_tag'>,
): PortalGroupCreated => ({ _tag: 'portal_group.created', ...args })

export const portalGroupUpdated = (
  args: Omit<PortalGroupUpdated, '_tag'>,
): PortalGroupUpdated => ({ _tag: 'portal_group.updated', ...args })

export const portalGroupDeleted = (
  args: Omit<PortalGroupDeleted, '_tag'>,
): PortalGroupDeleted => ({ _tag: 'portal_group.deleted', ...args })
