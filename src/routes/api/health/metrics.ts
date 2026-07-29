// Ops diagnostics — outbox lag, queue depths, worker heartbeat (BQR-6.2).
// Not a k8s probe: may hit DB and Redis; Cache-Control: no-store.
// Identifier-only payload (ADR 0030) — no review text, emails, or tokens.
//
// BQC-5.5 (STD-P1-04): the route no longer constructs DB/Redis readers — it
// consumes the composition-owned OperationsSnapshot, which owns health-checker
// construction, queue-depth/heartbeat reads, per-section time budgets, and
// degrade-not-abort assembly.
//
// BQC-7.2: PRIVATE operator surface. Gated by OPS_METRICS_TOKEN (env.ts) —
// `x-ops-token` header or `Authorization: Bearer <token>`. Fail-closed:
// absent env OR wrong/missing credential → 404 (not 403), so the endpoint's
// existence is not revealed to probing clients. The platform probes
// (/live /ready /started) deliberately stay unauthenticated.
import { createFileRoute } from '@tanstack/react-router'
import { getContainer } from '#/composition'
import { getEnv } from '#/shared/config/env'
import { isMetricsAuthorized } from '#/shared/health/metrics-access'

export const Route = createFileRoute('/api/health/metrics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isMetricsAuthorized(request.headers, getEnv().OPS_METRICS_TOKEN)) {
          return new Response(null, { status: 404 })
        }

        const snapshot = await getContainer().operationsSnapshot.read()

        return new Response(JSON.stringify(snapshot), {
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
