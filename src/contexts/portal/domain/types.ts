// Portal context — domain types
// Entity types for the portal bounded context.
// Per architecture: types are data only — no methods, no classes.
// readonly on every field. Branded IDs prevent accidental substitution.

import type { OrganizationId, PortalId, PropertyId, PortalLinkCategoryId, PortalLinkId } from '#/shared/domain/ids'

// ── Theme ──────────────────────────────────────────────────────────

export type PortalTheme = Readonly<{
  primaryColor: string
  backgroundColor?: string
  textColor?: string
}>

// ── Entity types ───────────────────────────────────────────────────

export type EntityType = 'property' | 'team' | 'staff'

// ── Portal ─────────────────────────────────────────────────────────

export type Portal = Readonly<{
  id: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  entityType: EntityType
  entityId: string
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: PortalTheme
  smartRoutingEnabled: boolean
  smartRoutingThreshold: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}>

// ── PortalLinkCategory ─────────────────────────────────────────────

export type PortalLinkCategory = Readonly<{
  id: PortalLinkCategoryId
  portalId: PortalId
  organizationId: OrganizationId
  title: string
  sortKey: string
  createdAt: Date
  updatedAt: Date
}>

// ── PortalLink ─────────────────────────────────────────────────────

export type PortalLink = Readonly<{
  id: PortalLinkId
  categoryId: PortalLinkCategoryId
  portalId: PortalId
  organizationId: OrganizationId
  label: string
  url: string
  iconKey: string | null
  sortKey: string
  createdAt: Date
  updatedAt: Date
}>

/** Re-export PortalId from shared for convenience */
export type { PortalId } from '#/shared/domain/ids'
