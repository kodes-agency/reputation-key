// Integration context — Drizzle repository implementation for GBP cache
// Per architecture: factory function returning Readonly<{ method }>.
// Uses onConflictDoUpdate for upserts based on (propertyId, dataType) unique constraint.

import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { gbpCache, properties } from '#/shared/db/schema'
import type { GbpCacheRepository } from '../../application/ports/gbp-cache.repository'
import { gbpCacheFromRow, gbpCacheToUpsert } from '../mappers/gbp-cache.mapper'
import { trace } from '#/shared/observability/trace'

export const createGbpCacheRepository = (db: Database): GbpCacheRepository => ({
  findByPropertyAndType: async (propertyId, dataType) => {
    return trace('gbpCache.findByPropertyAndType', async () => {
      const rows = await db
        .select()
        .from(gbpCache)
        .where(and(eq(gbpCache.propertyId, propertyId), eq(gbpCache.dataType, dataType)))
        .limit(1)
      return rows[0] ? gbpCacheFromRow(rows[0]) : null
    })
  },

  upsert: async (entry) => {
    return trace('gbpCache.upsert', async () => {
      await db
        .insert(gbpCache)
        .values(gbpCacheToUpsert(entry))
        .onConflictDoUpdate({
          target: [gbpCache.propertyId, gbpCache.dataType],
          set: {
            gbpPlaceId: entry.gbpPlaceId,
            payload: entry.payload,
            googleAttribution: entry.googleAttribution,
            fetchedAt: entry.fetchedAt,
            expiresAt: entry.expiresAt,
          },
        })
    })
  },

  deleteByProperty: async (propertyId, orgId) => {
    return trace('gbpCache.deleteByProperty', async () => {
      // Verify property belongs to the org before deleting cache entries
      const property = await db
        .select({ id: properties.id })
        .from(properties)
        .where(and(eq(properties.id, propertyId), eq(properties.organizationId, orgId)))
        .limit(1)
      if (property.length === 0) return
      await db.delete(gbpCache).where(eq(gbpCache.propertyId, propertyId))
    })
  },

  deleteExpired: async () => {
    return trace('gbpCache.deleteExpired', async () => {
      const result = await db
        .delete(gbpCache)
        .where(lt(gbpCache.expiresAt, new Date()))
        .returning({ id: gbpCache.id })
      return result.length
    })
  },

  deleteByConnectionId: async (connectionId, orgId) => {
    return trace('gbpCache.deleteByConnectionId', async () => {
      // Find all properties linked to this connection
      const propertyResult = await db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(
            eq(properties.googleConnectionId, connectionId),
            eq(properties.organizationId, orgId),
          ),
        )

      if (propertyResult.length === 0) {
        return 0
      }

      const propertyIds = propertyResult.map((p) => p.id)

      const result = await db
        .delete(gbpCache)
        .where(inArray(gbpCache.propertyId, propertyIds))
        .returning({ id: gbpCache.id })

      return result.length
    })
  },
})
