// Redis client factory
import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

// BQC-7.1: the production build bundles this module twice (nitro app chunk +
// lazy SSR chunk) — a module-level singleton would give each copy its own
// client and the graceful-shutdown plugin would quit the wrong one. The
// Symbol.for key shares one client process-wide.
const REDIS_KEY = Symbol.for('repkey.shared.cache.redis')
type RedisStore = { [REDIS_KEY]?: Redis }

function redisStore(): RedisStore {
  return globalThis as RedisStore
}

export function getRedis(): Redis | undefined {
  const store = redisStore()
  if (!store[REDIS_KEY]) {
    const env = getEnv()
    if (!env.REDIS_URL) return undefined

    const redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    redis.on('error', (err) => {
      if (env.NODE_ENV === 'development') {
        getLogger().warn({ err }, '[redis] connection error (dev mode — non-fatal)')
        return
      }
      getLogger().error({ err }, '[redis] connection error')
    })
    store[REDIS_KEY] = redis
  }
  return store[REDIS_KEY]
}

export async function isRedisHealthy(): Promise<boolean> {
  try {
    const redis = getRedis()
    if (!redis) return false
    const result = await redis.ping()
    return result === 'PONG'
  } catch (err) {
    getLogger().warn({ err }, '[redis] health check failed')
    return false
  }
}

/**
 * Quit the shared Redis client if it was created (BQC-7.1 graceful shutdown).
 * No-op when Redis was never initialized (REDIS_URL unset or no request
 * touched the cache/rate limiter). Resets the singleton so a later
 * getRedis() recreates the client.
 */
export async function closeRedis(): Promise<void> {
  const store = redisStore()
  const redis = store[REDIS_KEY]
  store[REDIS_KEY] = undefined
  if (redis && redis.status !== 'end') await redis.quit()
}
