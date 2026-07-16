// Readiness probe — DB + Redis must be healthy before traffic (BQR-6.1).
import { createFileRoute } from '@tanstack/react-router'
import { isRedisHealthy } from '#/shared/cache/redis'
import { isDbHealthy } from '#/shared/db'
import { readyProbe, probeHttpStatus } from '#/shared/health/probes'

export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: async () => {
        const [db, redis] = await Promise.all([isDbHealthy(), isRedisHealthy()])
        const result = readyProbe({ db, redis })
        return new Response(JSON.stringify(result), {
          status: probeHttpStatus(result.status),
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
