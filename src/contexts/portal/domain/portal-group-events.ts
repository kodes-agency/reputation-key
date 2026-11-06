import type { PortalGroupId } from '#/shared/domain/ids'
import type { PortalId } from './types'
import { portalError } from './errors'
import {
  assertPortalLifecycleFact,
  createPortalEvent,
  type PortalEventArgs,
  type PortalLifecycleFact,
} from './portal-event-base'

// ── Portal group events ───────────────────────────────────────────

export type PortalGroupCreated = PortalLifecycleFact<
  'portal_group.created',
  {
    portalGroupId: PortalGroupId
    name: string
  }
>

export type PortalGroupUpdated = PortalLifecycleFact<
  'portal_group.updated',
  {
    portalGroupId: PortalGroupId
    name: string
  }
>

export type PortalGroupDeleted = PortalLifecycleFact<
  'portal_group.deleted',
  {
    portalGroupId: PortalGroupId
  }
>

export type PortalAddedToGroup = PortalLifecycleFact<
  'portal_group.portal_added',
  {
    portalGroupId: PortalGroupId
    portalId: PortalId
  }
>

export type PortalRemovedFromGroup = PortalLifecycleFact<
  'portal_group.portal_removed',
  {
    portalGroupId: PortalGroupId
    portalId: PortalId
  }
>

// ── Portal group event constructors ────────────────────────────────

export const portalGroupCreated = (
  args: PortalEventArgs<PortalGroupCreated>,
): PortalGroupCreated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return createPortalEvent({
    _tag: 'portal_group.created',
    ...args,
  })
}

export const portalGroupUpdated = (
  args: PortalEventArgs<PortalGroupUpdated>,
): PortalGroupUpdated => {
  assertPortalLifecycleFact(args)
  if (!args.name || args.name.trim().length === 0) {
    throw portalError('invalid_name', 'name must be a non-empty string')
  }
  return createPortalEvent({
    _tag: 'portal_group.updated',
    ...args,
  })
}

export const portalGroupDeleted = (
  args: PortalEventArgs<PortalGroupDeleted>,
): PortalGroupDeleted => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_group.deleted',
    ...args,
  })
}

export const portalAddedToGroup = (
  args: PortalEventArgs<PortalAddedToGroup>,
): PortalAddedToGroup => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_group.portal_added',
    ...args,
  })
}

export const portalRemovedFromGroup = (
  args: PortalEventArgs<PortalRemovedFromGroup>,
): PortalRemovedFromGroup => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_group.portal_removed',
    ...args,
  })
}
