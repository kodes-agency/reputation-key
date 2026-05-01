// Redis client factory
import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

let _redis: Redis | undefined

export function getRedis(): Redis | undefined {
  if (!_redis) {
    const env = getEnv()
    if (!env.REDIS_URL) return undefined

    _redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    _redis.on('error', (err) => {
      if (env.NODE_ENV === 'development') {
        getLogger().warn({ err }, '[redis] connection error (dev mode — non-fatal)')
        return
      }
      getLogger().error({ err }, '[redis] connection error')
    })
  }
  return _redis
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
