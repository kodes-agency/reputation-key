// Redis cache implementation — implements the Cache port using ioredis.
// Values are serialized as JSON. TTL is supported via Redis EXPIRE.
// Graceful degradation: operations return safe defaults on Redis errors.

import type { Redis } from 'ioredis'
import type { Cache } from './cache.port'
import { getLogger } from '#/shared/observability/logger'

export function createRedisCache(redis: Redis): Cache {
  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const raw = await redis.get(key)
        if (raw === null) return null
        return JSON.parse(raw) as T
      } catch (err) {
        getLogger().warn({ err, key }, '[cache] get failed')
        return null
      }
    },

    async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
      try {
        const serialized = JSON.stringify(value)
        if (ttlSeconds !== undefined && ttlSeconds > 0) {
          await redis.set(key, serialized, 'EX', ttlSeconds)
        } else {
          await redis.set(key, serialized)
        }
      } catch (err) {
        getLogger().warn({ err, key }, '[cache] set failed')
      }
    },

    async delete(key: string): Promise<void> {
      try {
        await redis.del(key)
      } catch (err) {
        getLogger().warn({ err, key }, '[cache] delete failed')
      }
    },

    async exists(key: string): Promise<boolean> {
      try {
        const result = await redis.exists(key)
        return result === 1
      } catch (err) {
        getLogger().warn({ err, key }, '[cache] exists check failed')
        return false
      }
    },
  }
}
