import type { PortalLinkCategoryId, PortalLinkId } from '#/shared/domain/ids'
import type { PortalId } from './types'
import {
  assertPortalLifecycleFact,
  createPortalEvent,
  type PortalEventArgs,
  type PortalLifecycleFact,
} from './portal-event-base'

// ── Link category events ───────────────────────────────────────────

export type PortalLinkCategoryCreated = PortalLifecycleFact<
  'portal_link_category.created',
  {
    portalId: PortalId
    categoryId: PortalLinkCategoryId
  }
>

export type PortalLinkCategoryReordered = PortalLifecycleFact<
  'portal_link_category.reordered',
  {
    portalId: PortalId
  }
>

export type PortalLinkCategoryUpdated = PortalLifecycleFact<
  'portal_link_category.updated',
  {
    portalId: PortalId
    categoryId: PortalLinkCategoryId
  }
>

export type PortalLinkCategoryDeleted = PortalLifecycleFact<
  'portal_link_category.deleted',
  {
    portalId: PortalId
    categoryId: PortalLinkCategoryId
  }
>

// ── Link events ────────────────────────────────────────────────────

export type PortalLinkCreated = PortalLifecycleFact<
  'portal_link.created',
  {
    portalId: PortalId
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
  }
>

export type PortalLinkReordered = PortalLifecycleFact<
  'portal_link.reordered',
  {
    portalId: PortalId
    categoryId: PortalLinkCategoryId
  }
>

export type PortalLinkUpdated = PortalLifecycleFact<
  'portal_link.updated',
  {
    portalId: PortalId
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
  }
>

export type PortalLinkDeleted = PortalLifecycleFact<
  'portal_link.deleted',
  {
    portalId: PortalId
    linkId: PortalLinkId
    categoryId: PortalLinkCategoryId
  }
>

export const portalLinkCategoryCreated = (
  args: PortalEventArgs<PortalLinkCategoryCreated>,
): PortalLinkCategoryCreated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link_category.created',
    ...args,
  })
}

export const portalLinkCategoryReordered = (
  args: PortalEventArgs<PortalLinkCategoryReordered>,
): PortalLinkCategoryReordered => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link_category.reordered',
    ...args,
  })
}

export const portalLinkCategoryUpdated = (
  args: PortalEventArgs<PortalLinkCategoryUpdated>,
): PortalLinkCategoryUpdated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link_category.updated',
    ...args,
  })
}

export const portalLinkCategoryDeleted = (
  args: PortalEventArgs<PortalLinkCategoryDeleted>,
): PortalLinkCategoryDeleted => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link_category.deleted',
    ...args,
  })
}

export const portalLinkCreated = (
  args: PortalEventArgs<PortalLinkCreated>,
): PortalLinkCreated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link.created',
    ...args,
  })
}

export const portalLinkReordered = (
  args: PortalEventArgs<PortalLinkReordered>,
): PortalLinkReordered => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link.reordered',
    ...args,
  })
}

export const portalLinkUpdated = (
  args: PortalEventArgs<PortalLinkUpdated>,
): PortalLinkUpdated => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link.updated',
    ...args,
  })
}

export const portalLinkDeleted = (
  args: PortalEventArgs<PortalLinkDeleted>,
): PortalLinkDeleted => {
  assertPortalLifecycleFact(args)
  return createPortalEvent({
    _tag: 'portal_link.deleted',
    ...args,
  })
}
