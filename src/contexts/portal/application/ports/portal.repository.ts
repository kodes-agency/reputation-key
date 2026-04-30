// Portal context — repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { Portal, PortalId } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

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
}>
