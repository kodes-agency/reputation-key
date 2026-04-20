import { createFileRoute } from '@tanstack/react-router'
import { healthCheck } from '#/shared/health/server'

export const Route = createFileRoute('/api/health/')({
  server: {
    handlers: {
      GET: async () => {
        const result = await healthCheck()
        const status = result.db && result.redis ? 200 : 503
        return new Response(JSON.stringify(result), {
          status,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
