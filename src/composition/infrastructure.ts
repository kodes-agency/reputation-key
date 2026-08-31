import type { Redis } from 'ioredis'
import type { Queue } from 'bullmq'
import type { Cache } from '#/shared/cache/cache.port'
import { createRedisCache } from '#/shared/cache/redis-cache'
import { createNoopCache } from '#/shared/cache/noop-cache'
import { createRateLimiter, type RateLimiter } from '#/shared/rate-limit/middleware'
import { createJobQueue } from '#/shared/jobs/queue'
import { createJobRegistry, type JobRegistry } from '#/shared/jobs/registry'

export type InfrastructureBuildInput = Readonly<{
  redis: Redis | undefined
  enableJobs: boolean
  queue?: Queue
  backgroundQueue?: Queue
}>

export type Infrastructure = Readonly<{
  cache: Cache
  rateLimiter: RateLimiter
  jobQueue: Queue | undefined
  backgroundQueue: Queue | undefined
  jobRegistry: JobRegistry
}>

/** Build process-local infrastructure without reading ambient configuration. */
export function buildInfrastructure(options: InfrastructureBuildInput): Infrastructure {
  const cache: Cache = options.redis ? createRedisCache(options.redis) : createNoopCache()
  const rateLimiter: RateLimiter = createRateLimiter(options.redis, {
    keyPrefix: 'ratelimit:public',
    maxRequests: 60,
    windowSeconds: 60,
  })
  const jobQueue =
    options.queue ?? (options.redis ? createJobQueue('default') : undefined)
  const backgroundQueue =
    options.backgroundQueue ??
    (options.enableJobs && options.redis ? createJobQueue('background') : undefined)

  return Object.freeze({
    cache,
    rateLimiter,
    jobQueue,
    backgroundQueue,
    jobRegistry: createJobRegistry(),
  })
}
