// Readiness probe — what is required to serve traffic, each
// check under a hard per-probe budget (READINESS_PROBE_BUDGET_MS): the
// application container is built (which reads every key group construction
// needs) AND the required keys parse AND DB healthy AND Redis healthy AND
// applied migrations match the on-disk journal AND the static policy
// configuration is valid. 503 when ANY probe degrades, and for good once the
// process is draining; per-probe results are in the body.
//
// WORKER HEARTBEAT IS DELIBERATELY NOT PART OF WEB READINESS: the web tier
// serves traffic without a worker, so a degraded non-critical worker must
// not take web traffic down. Worker-heartbeat alerting consumes the ops
// metrics snapshot (/api/health/metrics).
import { createFileRoute } from '@tanstack/react-router'
import { isContainerReady } from '#/composition/container-readiness.server'
import { areRedisDependenciesHealthy } from '#/shared/health/redis-dependencies'
import { isDbHealthy } from '#/shared/health/db-probe'
import { probeHttpStatus } from '#/shared/health/probes'
import {
  isMigrationJournalMatched,
  isKeyConfigurationReady,
  isPolicyConfigurationReady,
  runReadiness,
} from '#/shared/health/readiness'

export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: async () => {
        const result = await runReadiness({
          container: isContainerReady,
          keys: isKeyConfigurationReady,
          db: isDbHealthy,
          redis: areRedisDependenciesHealthy,
          migrations: isMigrationJournalMatched,
          policy: isPolicyConfigurationReady,
        })
        return new Response(JSON.stringify(result), {
          status: probeHttpStatus(result.status),
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
