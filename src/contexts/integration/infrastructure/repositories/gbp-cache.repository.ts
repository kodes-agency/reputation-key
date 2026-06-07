// Integration context — Drizzle repository implementation for GBP cache
// Per architecture: factory function returning Readonly<{ method }>.
// Uses onConflictDoUpdate for upserts based on (organizationId, propertyId, dataType) unique constraint.
// Property table queries are delegated to PropertyQueryPort to avoid direct cross-context DB access.

import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { gbpCache } from '#/shared/db/schema'
import type { GbpCacheRepository } from '../../application/ports/gbp-cache.repository'
import type { PropertyQueryPort } from '../../application/ports/property-query.port'
import { gbpCacheFromRow, gbpCacheToUpsert } from '../mappers/gbp-cache.mapper'
import { trace } from '#/shared/observability/trace'

export const createGbpCacheRepository = (
  db: Database,
  propertyQuery: PropertyQueryPort,
): GbpCacheRepository => ({
  findByPropertyAndType: async (organizationId, propertyId, dataType) => {
    return trace('gbpCache.findByPropertyAndType', async () => {
      const rows = await db
        .select()
        .from(gbpCache)
        .where(
          and(
            eq(gbpCache.organizationId, organizationId),
            eq(gbpCache.propertyId, propertyId),
            eq(gbpCache.dataType, dataType),
          ),
        )
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
          target: [gbpCache.organizationId, gbpCache.propertyId, gbpCache.dataType],
          set: {
            gbpPlaceId: entry.gbpPlaceId,
            payload: entry.payload,
            googleAttribution: entry.googleAttribution,
            fetchedAt: entry.fetchedAt,
            expiresAt: entry.expiresAt,
            updatedAt: new Date(),
          },
        })
    })
  },

  deleteByProperty: async (propertyId, orgId) => {
    return trace('gbpCache.deleteByProperty', async () => {
      // Verify property belongs to the org via port — Property table belongs to another context
      const belongs = await propertyQuery.belongsToOrg(propertyId, orgId)
      if (!belongs) return
      // Defense-in-depth: scope DELETE by both propertyId AND organizationId
      await db
        .delete(gbpCache)
        .where(
          and(eq(gbpCache.propertyId, propertyId), eq(gbpCache.organizationId, orgId)),
        )
    })
  },

  /** System-level cleanup — no tenant filter by design. Scheduled job purges expired cache entries across all orgs. */
  deleteAllExpired: async () => {
    return trace('gbpCache.deleteAllExpired', async () => {
      const result = await db
        .delete(gbpCache)
        .where(lt(gbpCache.expiresAt, new Date()))
        .returning({ id: gbpCache.id })
      return result.length
    })
  },

  deleteByConnectionId: async (connectionId, orgId) => {
    return trace('gbpCache.deleteByConnectionId', async () => {
      // Find all properties linked to this connection via port
      const propertyIds = await propertyQuery.findIdsByGoogleConnection(
        connectionId,
        orgId,
      )

      if (propertyIds.length === 0) {
        return 0
      }

      const result = await db
        .delete(gbpCache)
        .where(
          and(
            inArray(gbpCache.propertyId, propertyIds),
            eq(gbpCache.organizationId, orgId),
          ),
        )
        .returning({ id: gbpCache.id })

      return result.length
    })
  },
})
