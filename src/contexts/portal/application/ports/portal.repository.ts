// Portal context — repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { Portal, PortalId } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

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
  resolvePortalContext: (
    portalIdParam: PortalId,
  ) => Promise<ResolvePortalContextResult | null>
}>
