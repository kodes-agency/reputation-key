// Ops diagnostics — outbox lag, queue depths, worker heartbeat (BQR-6.2).
// Not a k8s probe: may hit DB and Redis; Cache-Control: no-store.
// Identifier-only payload (ADR 0030) — no review text, emails, or tokens.
import { createFileRoute } from '@tanstack/react-router'
import { getContainer } from '#/composition'
import { getDb } from '#/shared/db'
import { getRedis } from '#/shared/cache/redis'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import { readAllQueueDepths } from '#/shared/health/queue-depth'
import { readWorkerHeartbeat } from '#/shared/health/worker-heartbeat'

export const Route = createFileRoute('/api/health/metrics')({
  server: {
    handlers: {
      GET: async () => {
        const container = getContainer()
        const checker = createHealthChecker(getDb(), container.outboxRepo)
        const [snapshot, queues, heartbeat] = await Promise.all([
          checker.check(),
          readAllQueueDepths([
            { name: 'default', queue: container.jobQueue ?? null },
            { name: 'background', queue: container.backgroundQueue ?? null },
          ]),
          readWorkerHeartbeat(getRedis() ?? undefined, container.clock),
        ])

        const body = {
          ...snapshot,
          queues,
          workers: {
            ...snapshot.workers,
            heartbeat,
          },
        }

        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
