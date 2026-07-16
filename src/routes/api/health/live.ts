// Liveness probe — process is up. Does not check dependencies (BQR-6.1).
import { createFileRoute } from '@tanstack/react-router'
import { liveProbe } from '#/shared/health/probes'

export const Route = createFileRoute('/api/health/live')({
  server: {
    handlers: {
      GET: async () => {
        const result = liveProbe()
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
