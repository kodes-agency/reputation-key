// Combined health endpoint (backward compatible).
// Prefer /api/health/live, /api/health/ready and /api/health/started for
// orchestration (BQR-6.1). BQC-7.2: same upgraded readiness semantics as
// /api/health/ready (DB + Redis + migrations + policy, per-probe budgets) —
// the response shape stays compatible by ADDING fields, never removing.
import { createFileRoute } from '@tanstack/react-router'
import { areRedisDependenciesHealthy } from '#/shared/health/redis-dependencies'
import { isDbHealthy } from '#/shared/health/db-probe'
import { probeHttpStatus } from '#/shared/health/probes'
import {
  isMigrationJournalMatched,
  isPolicyConfigurationReady,
  runReadiness,
} from '#/shared/health/readiness'

export const Route = createFileRoute('/api/health/')({
  server: {
    handlers: {
      GET: async () => {
        const result = await runReadiness({
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
