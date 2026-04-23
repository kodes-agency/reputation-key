import { createFileRoute } from '@tanstack/react-router'
import { isRedisHealthy } from '#/shared/cache/redis'
import { isDbHealthy } from '#/shared/db'

export const Route = createFileRoute('/api/health/')({
  server: {
    handlers: {
      GET: async () => {
        const [db, redis] = await Promise.all([isDbHealthy(), isRedisHealthy()])

        const result = {
          status: db && redis ? 'ok' : 'degraded',
          db,
          redis,
          timestamp: new Date().toISOString(),
        }

        const status = db && redis ? 200 : 503
        return new Response(JSON.stringify(result), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
