// Integration context — GBP cache repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Cache entries are indexed by organizationId + propertyId + dataType for tenant-isolated lookups.

import type { GbpCacheEntry, GbpCacheDataType } from '../../domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

export type GbpCacheRepository = Readonly<{
  findByPropertyAndType: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    dataType: GbpCacheDataType,
  ) => Promise<GbpCacheEntry | null>
  upsert: (entry: GbpCacheEntry) => Promise<void>
  deleteByProperty: (propertyId: PropertyId, orgId: string) => Promise<void>
  deleteAllExpired: () => Promise<number>
  deleteByConnectionId: (connectionId: string, orgId: string) => Promise<number>
}>
