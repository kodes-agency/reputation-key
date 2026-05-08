import type { Job } from 'bullmq'
import type { JobHandler } from '../registry'
import { getDb } from '#/shared/db'
import { gbpCache, properties } from '#/shared/db/schema'
// eslint-disable-next-line no-restricted-imports -- Job handlers need drizzle operators for database queries
import { lt, isNotNull } from 'drizzle-orm'

export type SyncGbpCacheJobData = {
  dataType: 'reviews' | 'location'
}

// Sync GBP cache data for all connected properties
// This is a background job — errors are logged, not thrown
export const syncGbpCacheHandler: JobHandler<SyncGbpCacheJobData> = async (
  _job: Job<SyncGbpCacheJobData>,
) => {
  const db = getDb()

  // Find all active properties with a google connection
  const linkedProperties = await db
    .select({
      propertyId: properties.id,
      gbpPlaceId: properties.gbpPlaceId,
      googleConnectionId: properties.googleConnectionId,
      orgId: properties.organizationId,
    })
    .from(properties)
    .where(isNotNull(properties.googleConnectionId))
    .limit(200)

  if (linkedProperties.length === 0) return

  // NOTE: This handler requires a wired GBP API adapter to produce real data.
  // Until the full sync flow is connected, writing placeholder payloads would
  // pollute the cache with useless entries — so we skip the write entirely.
}

// Purge expired cache entries (run daily)
export const purgeExpiredCacheHandler: JobHandler = async () => {
  const db = getDb()
  const now = new Date()

  await db.delete(gbpCache).where(lt(gbpCache.expiresAt, now))
}
