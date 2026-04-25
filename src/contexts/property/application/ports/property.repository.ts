// Property context — repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Every method takes organizationId as the first parameter (tenant isolation).

import type { Property, PropertyId } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

export type PropertyRepository = Readonly<{
  findById: (orgId: OrganizationId, id: PropertyId) => Promise<Property | null>
  list: (orgId: OrganizationId) => Promise<ReadonlyArray<Property>>
  slugExists: (
    orgId: OrganizationId,
    slug: string,
    excludeId?: PropertyId,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, property: Property) => Promise<void>
  update: (
    orgId: OrganizationId,
    id: PropertyId,
    patch: Readonly<Partial<Property>>,
  ) => Promise<void>
  softDelete: (orgId: OrganizationId, id: PropertyId) => Promise<void>
}>
