// Redis client factory
import { Redis } from 'ioredis'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

let _redis: Redis | undefined

export function getRedis(): Redis | undefined {
  const env = getEnv()
  if (!env.REDIS_URL) return undefined

  if (!_redis) {
    _redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    _redis.on('error', (err) => {
      // Swallow connection errors in dev — health check will report status
      if (env.NODE_ENV === 'development') return
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
