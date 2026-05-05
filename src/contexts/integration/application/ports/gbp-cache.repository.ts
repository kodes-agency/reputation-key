// Integration context — GBP cache repository port
// Per architecture: "Ports are TypeScript types defining capability contracts."
// Cache entries are indexed by propertyId + dataType for efficient lookups.

import type { GbpCacheEntry, GbpCacheDataType } from '../../domain/types'
import type { PropertyId } from '#/shared/domain/ids'

export type GbpCacheRepository = Readonly<{
  findByPropertyAndType: (propertyId: PropertyId, dataType: GbpCacheDataType) => Promise<GbpCacheEntry | null>
  upsert: (entry: GbpCacheEntry) => Promise<void>
  deleteByProperty: (propertyId: PropertyId) => Promise<void>
  deleteExpired: () => Promise<number>
  deleteByConnectionId: (connectionId: string) => Promise<number>
}>
