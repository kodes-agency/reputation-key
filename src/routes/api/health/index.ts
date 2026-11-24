// Combined health endpoint (backward compatible).
// Prefer /api/health/live, /api/health/ready and /api/health/started for
// orchestration. Same upgraded readiness semantics as
// /api/health/ready (container + keys + DB + Redis + migrations + policy,
// per-probe budgets) —
// the response shape stays compatible by ADDING fields, never removing.
import { createFileRoute } from '@tanstack/react-router'
import { readinessResponse } from './-readiness-response'

export const Route = createFileRoute('/api/health/')({
  server: {
    handlers: {
      GET: readinessResponse,
    },
  },
})
