// Startup probe (BQC-7.2) — 200 only when boot/config initialization is
// COMPLETE: the composition container builds (getContainer() succeeds), the
// applied migration set matches the on-disk journal, and the persisted
// policy state is readable. Until then 503. This is the platform ACTIVATION
// gate — railway.json healthcheckPath points here (activation ≠ liveness:
// /api/health/live stays the dependency-free process check; a dependency
// flap after activation must not restart the container).
//
// The worker's startup posture is PROCESS-level, not endpoint-level: the
// worker process fails boot on assertJobReadiness (src/worker/index.ts)
// after bootstrap + policy refresh — it exposes no HTTP surface.
import { createFileRoute } from '@tanstack/react-router'
import { getContainer } from '#/composition'
import { probeHttpStatus } from '#/shared/health/probes'
import {
  isMigrationJournalMatched,
  isPolicyStateReadable,
  runStartup,
} from '#/shared/health/readiness'

export const Route = createFileRoute('/api/health/started')({
  server: {
    handlers: {
      GET: async () => {
        const result = await runStartup({
          container: () => {
            getContainer()
            return true
          },
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
