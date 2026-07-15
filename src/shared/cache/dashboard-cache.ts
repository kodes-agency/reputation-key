// Property-scoped dashboard cache (PRE17C).
//
// Wraps Redis with per-property key scoping and TTL. Dashboard queries
// check the cache before hitting the database, reducing load at scale.
//
// Cache keys are property-scoped: `dashboard:{propertyId}:{queryType}:{paramsHash}`
// This ensures one property's data never leaks into another's cache entry.
// Invalidates on property data changes (reviews, inbox, metrics).

import type { Redis } from 'ioredis'
import { getLogger } from '#/shared/observability/logger'
import type { PropertyId, OrganizationId } from '#/shared/domain/ids'

const CACHE_PREFIX = 'dashboard'
const DEFAULT_TTL_SECONDS = 60 // 1 minute — short for freshness, long enough to absorb bursts

export type DashboardCache = Readonly<{
  /** Get a cached query result. Returns null on miss. */
  get: <T>(key: DashboardCacheKey) => Promise<T | null>
  /** Set a query result in the cache. */
  set: <T>(key: DashboardCacheKey, value: T, ttlSeconds?: number) => Promise<void>
  /** Invalidate all cached entries for a property. */
  invalidateProperty: (propertyId: PropertyId) => Promise<void>
  /** Invalidate all cached entries for an organization. */
  invalidateOrganization: (orgId: OrganizationId) => Promise<void>
}>

export type DashboardCacheKey = Readonly<{
  propertyId: PropertyId
  queryType: string
  /** Hash of query parameters (filters, date range, etc.) */
  paramsHash: string
}>

/**
 * Create a Redis-backed dashboard cache.
 * Returns a no-op cache if Redis is not available.
 */
export function createDashboardCache(redis: Redis | undefined): DashboardCache {
  const logger = getLogger()

  if (!redis) {
    logger.warn('Dashboard cache: no Redis — using no-op cache')
    return {
      get: async () => null,
      set: async () => {},
      invalidateProperty: async () => {},
      invalidateOrganization: async () => {},
    }
  }

  const buildKey = (key: DashboardCacheKey): string =>
    `${CACHE_PREFIX}:${key.propertyId}:${key.queryType}:${key.paramsHash}`

  return {
    get: async <T>(key: DashboardCacheKey): Promise<T | null> => {
      try {
        const cached = await redis.get(buildKey(key))
        if (!cached) return null
        return JSON.parse(cached) as T
      } catch (err) {
        logger.warn(
          { err, key: buildKey(key) },
          'Dashboard cache get failed — treating as miss',
        )
        return null
      }
    },

    set: async <T>(
      key: DashboardCacheKey,
      value: T,
      ttlSeconds = DEFAULT_TTL_SECONDS,
    ): Promise<void> => {
      try {
        await redis.setex(buildKey(key), ttlSeconds, JSON.stringify(value))
      } catch (err) {
        logger.warn({ err, key: buildKey(key) }, 'Dashboard cache set failed — non-fatal')
      }
    },

    invalidateProperty: async (propertyId: PropertyId): Promise<void> => {
      try {
        // Scan and delete all keys matching this property's prefix
        const pattern = `${CACHE_PREFIX}:${propertyId}:*`
        let cursor = '0'
        do {
          const [nextCursor, keys] = await redis.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100,
          )
          cursor = nextCursor
          if (keys.length > 0) {
            await redis.del(...keys)
          }
        } while (cursor !== '0')
      } catch (err) {
        logger.warn({ err, propertyId }, 'Dashboard cache property invalidation failed')
      }
    },

    invalidateOrganization: async (orgId: OrganizationId): Promise<void> => {
      try {
        // Organization-level invalidation is more expensive — scan all dashboard keys
        // and check organization membership. For now, this is a no-op since
        // dashboard keys are property-scoped, not org-scoped.
        // Use invalidateProperty for each property in the org if needed.
        logger.debug(
          { orgId },
          'Dashboard cache org invalidation — use per-property instead',
        )
      } catch (err) {
        logger.warn({ err, orgId }, 'Dashboard cache org invalidation failed')
      }
    },
  }
}
