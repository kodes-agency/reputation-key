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
  job: Job<SyncGbpCacheJobData>,
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

  // Group by connection ID for batched API calls
  const byConnection = new Map<string, typeof linkedProperties>()
  for (const p of linkedProperties) {
    if (!p.googleConnectionId) continue
    const existing = byConnection.get(p.googleConnectionId) ?? []
    existing.push(p)
    byConnection.set(p.googleConnectionId, existing)
  }

  // For each connection, fetch and cache GBP data
  // NOTE: In production, this would use the GBP API adapter to fetch real data.
  // For now, this creates placeholder cache entries that will be refreshed
  // when the full sync flow is connected to the API.
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days

  for (const [_connectionId, props] of byConnection) {
    for (const p of props) {
      try {
        // Upsert cache entry
        // In production: fetch from GBP API, store real data + attribution
        await db
          .insert(gbpCache)
          .values({
            propertyId: p.propertyId,
            gbpPlaceId: p.gbpPlaceId ?? '',
            dataType: job.data.dataType,
            payload: { syncedAt: now.toISOString() },
            googleAttribution: null,
            fetchedAt: now,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [gbpCache.propertyId, gbpCache.dataType],
            set: {
              payload: { syncedAt: now.toISOString() },
              fetchedAt: now,
              expiresAt,
            },
          })
      } catch (err) {
        // Log and continue — background job should not fail on individual items
        console.error(`Failed to sync cache for property ${p.propertyId}:`, err)
      }
    }
  }
}

// Purge expired cache entries (run daily)
export const purgeExpiredCacheHandler: JobHandler = async () => {
  const db = getDb()
  const now = new Date()

  const result = await db
    .delete(gbpCache)
    .where(lt(gbpCache.expiresAt, now))
    .returning({ id: gbpCache.id })

  console.log(`Purged ${result.length} expired GBP cache entries`)
}
