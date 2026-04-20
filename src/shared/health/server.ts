import { createServerFn } from '@tanstack/react-start'
import { isRedisHealthy } from '#/shared/cache/redis'
import { isDbHealthy } from '#/shared/db'

export const healthCheck = createServerFn({
  method: 'GET',
}).handler(async () => {
  const [db, redis] = await Promise.all([isDbHealthy(), isRedisHealthy()])

  return {
    status: db && redis ? 'ok' : 'degraded',
    db,
    redis,
    timestamp: new Date().toISOString(),
  }
})
