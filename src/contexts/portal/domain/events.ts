// Portal context — domain events
// Per architecture: "Events are facts, named in the past tense."
// Events live in their owning context's domain/events.ts.

import type { PortalId } from './types'
import type { OrganizationId } from '#/shared/domain/ids'

// ── Portal events ──────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalUpdated = Readonly<{
  _tag: 'portal.updated'
  portalId: PortalId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalDeleted = Readonly<{
  _tag: 'portal.deleted'
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
}>

// ── Link category events ───────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type PortalLinkCategoryCreated = Readonly<{
  _tag: 'portal_link_category.created'
  portalId: PortalId
  categoryId: string
  organizationId: OrganizationId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalLinkCategoryReordered = Readonly<{
  _tag: 'portal_link_category.reordered'
  portalId: PortalId
  organizationId: OrganizationId
  occurredAt: Date
}>

// ── Link events ────────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type PortalLinkCreated = Readonly<{
  _tag: 'portal_link.created'
  portalId: PortalId
  linkId: string
  categoryId: string
  organizationId: OrganizationId
  occurredAt: Date
}>

// fallow-ignore-next-line unused-type
export type PortalLinkReordered = Readonly<{
  _tag: 'portal_link.reordered'
  portalId: PortalId
  categoryId: string
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

// ── Event constructors ─────────────────────────────────────────────

export const portalCreated = (args: Omit<PortalCreated, '_tag'>): PortalCreated => ({
  _tag: 'portal.created',
  ...args,
})

export const portalUpdated = (args: Omit<PortalUpdated, '_tag'>): PortalUpdated => ({
  _tag: 'portal.updated',
  ...args,
})

export const portalDeleted = (args: Omit<PortalDeleted, '_tag'>): PortalDeleted => ({
  _tag: 'portal.deleted',
  ...args,
})

export const portalLinkCategoryCreated = (
  args: Omit<PortalLinkCategoryCreated, '_tag'>,
): PortalLinkCategoryCreated => ({ _tag: 'portal_link_category.created', ...args })

export const portalLinkCategoryReordered = (
  args: Omit<PortalLinkCategoryReordered, '_tag'>,
): PortalLinkCategoryReordered => ({ _tag: 'portal_link_category.reordered', ...args })

export const portalLinkCreated = (
  args: Omit<PortalLinkCreated, '_tag'>,
): PortalLinkCreated => ({ _tag: 'portal_link.created', ...args })

export const portalLinkReordered = (
  args: Omit<PortalLinkReordered, '_tag'>,
): PortalLinkReordered => ({ _tag: 'portal_link.reordered', ...args })
