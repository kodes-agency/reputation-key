// Readiness probe (BQR-6.1, BQC-7.2) — the dependencies required to serve
// traffic, each under a hard per-probe budget (READINESS_PROBE_BUDGET_MS):
// DB healthy AND Redis healthy AND applied migrations match the on-disk
// journal AND the persisted policy state is readable. 503 when ANY probe
// degrades; per-probe results are in the body.
//
// WORKER HEARTBEAT IS DELIBERATELY NOT PART OF WEB READINESS: the web tier
// serves traffic without a worker, so a degraded non-critical worker must
// not take web traffic down. Worker-heartbeat alerting consumes the ops
// metrics snapshot (/api/health/metrics) — that is BQC-7.4's job.
import { createFileRoute } from '@tanstack/react-router'
import { isRedisHealthy } from '#/shared/cache/redis'
import { isDbHealthy } from '#/shared/health/db-probe'
import { probeHttpStatus } from '#/shared/health/probes'
import {
  isMigrationJournalMatched,
  isPolicyStateReadable,
  runReadiness,
} from '#/shared/health/readiness'

export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: async () => {
        const result = await runReadiness({
          db: isDbHealthy,
          redis: isRedisHealthy,
          migrations: isMigrationJournalMatched,
          policy: isPolicyStateReadable,
        })
        return new Response(JSON.stringify(result), {
          status: probeHttpStatus(result.status),
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
