// Integration context — row ↔ domain mapper for GBP cache entries
// Per architecture: pure functions, the only place where both row and domain shapes are known.

import type { gbpCache } from '#/shared/db/schema/gbp-cache.schema'
import type { GbpCacheEntry } from '../../domain/types'
import { organizationId, propertyId, gbpCacheEntryId, unbrand } from '#/shared/domain/ids'
import { createGbpCacheEntry } from '../../domain/constructors'

type GbpCacheRow = typeof gbpCache.$inferSelect
type GbpCacheUpsertRow = typeof gbpCache.$inferInsert

export const gbpCacheFromRow = (row: GbpCacheRow): GbpCacheEntry => {
  const result = createGbpCacheEntry({
    id: gbpCacheEntryId(row.id),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    gbpPlaceId: row.gbpPlaceId,
    dataType: row.dataType,
    payload: row.payload,
    googleAttribution: row.googleAttribution,
    fetchedAt: row.fetchedAt,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
  })
  if (result.isErr()) {
    throw new Error(`Invalid GBP cache entry from DB: ${result.error.message}`)
  }
  return result.value
}

export const gbpCacheToUpsert = (entry: GbpCacheEntry): GbpCacheUpsertRow => ({
  id: unbrand(entry.id),
  organizationId: unbrand(entry.organizationId),
  propertyId: unbrand(entry.propertyId),
  gbpPlaceId: entry.gbpPlaceId,
  dataType: entry.dataType,
  payload: entry.payload,
  googleAttribution: entry.googleAttribution,
  fetchedAt: entry.fetchedAt,
  expiresAt: entry.expiresAt,
  updatedAt: entry.updatedAt ?? new Date(),
})
