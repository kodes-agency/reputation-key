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
import { readinessResponse } from './-readiness-response'

export const Route = createFileRoute('/api/health/ready')({
  server: {
    handlers: {
      GET: readinessResponse,
    },
  },
})
