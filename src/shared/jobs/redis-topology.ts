export type RedisTopologyEnv = Readonly<{
  NODE_ENV?: string
  REDIS_URL?: string
  QUEUE_REDIS_URL?: string
}>

type RedisEndpoint = Readonly<{ host: string; port: string }>

function redisEndpoint(raw: string): RedisEndpoint | undefined {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') return undefined
    if (!parsed.hostname) return undefined
    return {
      host: parsed.hostname.toLowerCase(),
      port: parsed.port || '6379',
    }
  } catch {
    return undefined
  }
}

/**
 * Production has a dedicated BullMQ resource. Test/development retain the
 * historical one-Redis fallback so hermetic suites and lightweight local
 * development do not need a second daemon.
 */
export function getJobRedisUrl(env: RedisTopologyEnv): string | undefined {
  return (
    env.QUEUE_REDIS_URL ?? (env.NODE_ENV === 'production' ? undefined : env.REDIS_URL)
  )
}

/** Refuse a production process whose cache/rate-limit and queue stores share a host. */
export function assertProductionRedisTopology(env: RedisTopologyEnv): void {
  if (env.NODE_ENV !== 'production') return
  if (!env.REDIS_URL) {
    throw new Error('[CONFIG] Redis topology is incompatible: cache_url_missing')
  }
  if (!env.QUEUE_REDIS_URL) {
    throw new Error('[CONFIG] Redis topology is incompatible: queue_url_missing')
  }
  const cache = redisEndpoint(env.REDIS_URL)
  if (!cache) {
    throw new Error('[CONFIG] Redis topology is incompatible: cache_url_invalid')
  }
  const queue = redisEndpoint(env.QUEUE_REDIS_URL)
  if (!queue) {
    throw new Error('[CONFIG] Redis topology is incompatible: queue_url_invalid')
  }
  if (cache.host === queue.host && cache.port === queue.port) {
    throw new Error('[CONFIG] Redis topology is incompatible: endpoints_not_isolated')
  }
}
