// Ops diagnostics — outbox lag, queue depths, worker heartbeat (BQR-6.2).
// Not a k8s probe: may hit DB and Redis; Cache-Control: no-store.
// Identifier-only payload (ADR 0030) — no review text, emails, or tokens.
//
// BQC-3.7: the queue-depth read now includes domain-events and quarantine,
// and the snapshot carries the quarantine dead-letter metrics (count + oldest
// age). The two worker-owned queues are opened lazily here (read-only
// handles, memoized per process).
import { createFileRoute } from '@tanstack/react-router'
import { getContainer } from '#/composition'
import { getDb } from '#/shared/db'
import { getRedis } from '#/shared/cache/redis'
import { createHealthChecker } from '#/shared/observability/health-metrics'
import { readAllQueueDepths } from '#/shared/health/queue-depth'
import { readWorkerHeartbeat } from '#/shared/health/worker-heartbeat'
import { createJobQueue, type Queue } from '#/shared/jobs/queue'
import { QUARANTINE_QUEUE_NAME } from '#/shared/jobs/failure-quarantine'

// BQC-3.7: worker-owned queues are not on the container; open read-only
// handles once per process for the depth/metrics reads.
let opsQueues:
  | { domainEvents: Queue | undefined; quarantine: Queue | undefined }
  | undefined

function getOpsQueues(): {
  domainEvents: Queue | undefined
  quarantine: Queue | undefined
} {
  if (!opsQueues) {
    opsQueues = {
      domainEvents: createJobQueue('domain-events'),
      quarantine: createJobQueue(QUARANTINE_QUEUE_NAME),
    }
  }
  return opsQueues
}

export const Route = createFileRoute('/api/health/metrics')({
  server: {
    handlers: {
      GET: async () => {
        const container = getContainer()
        const ops = getOpsQueues()
        const checker = createHealthChecker(getDb(), container.outboxRepo, {
          quarantineQueue: ops.quarantine ?? null,
        })
        const [snapshot, queues, heartbeat] = await Promise.all([
          checker.check(),
          readAllQueueDepths([
            { name: 'default', queue: container.jobQueue ?? null },
            { name: 'background', queue: container.backgroundQueue ?? null },
            { name: 'domain-events', queue: ops.domainEvents ?? null },
            { name: QUARANTINE_QUEUE_NAME, queue: ops.quarantine ?? null },
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
