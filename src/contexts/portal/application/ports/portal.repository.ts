// Portal context — repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { Portal, PortalId } from '../../domain/types'
import type { OrganizationId, PropertyId, PortalGroupId } from '#/shared/domain/ids'

export type PortalQrInfo = Readonly<{
  slug: string
  propertySlug: string
}>

export type PublicPortalResult = Readonly<{
  portal: Readonly<{
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
    smartRoutingEnabled: boolean
    smartRoutingThreshold: number
    organizationName: string
  }>
  categories: ReadonlyArray<{ id: string; title: string; sortKey: string }>
  links: ReadonlyArray<{
    id: string
    label: string
    url: string
    categoryId: string | null
    sortKey: string
  }>
  organizationId: string
  propertyId: string
}>

export type ResolvePortalContextResult = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

export type PortalRepository = Readonly<{
  findById: (orgId: OrganizationId, id: PortalId) => Promise<Portal | null>
  findBySlug: (orgId: OrganizationId, slug: string) => Promise<Portal | null>
  list: (orgId: OrganizationId) => Promise<ReadonlyArray<Portal>>
  listByProperty: (
    orgId: OrganizationId,
    propertyId: string,
  ) => Promise<ReadonlyArray<Portal>>
  slugExists: (
    orgId: OrganizationId,
    propertyId: string,
    slug: string,
    excludeId?: PortalId,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, portal: Portal) => Promise<void>
  update: (
    orgId: OrganizationId,
    id: PortalId,
    patch: Readonly<Partial<Portal>>,
  ) => Promise<void>
  softDelete: (orgId: OrganizationId, id: PortalId) => Promise<void>
  getPortalQrInfo: (orgId: OrganizationId, id: PortalId) => Promise<PortalQrInfo | null>
  resolvePortalContext: (
    portalIdParam: PortalId,
  ) => Promise<ResolvePortalContextResult | null>
  findPublicPortalBySlug: (
    propertySlug: string,
    portalSlug: string,
  ) => Promise<PublicPortalResult | null>

  // ── Staff goal resolution ────────────────────────────────────────────
  // Given portal IDs, return the distinct group IDs those portals belong to.
  // Portals without a group are excluded from the result.
  findGroupIdsByPortalIds: (
    orgId: OrganizationId,
    portalIds: ReadonlyArray<PortalId>,
  ) => Promise<ReadonlyArray<PortalGroupId>>
}>
