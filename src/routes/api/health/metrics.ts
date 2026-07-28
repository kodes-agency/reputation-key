// Ops diagnostics — outbox lag, queue depths, worker heartbeat (BQR-6.2).
// Not a k8s probe: may hit DB and Redis; Cache-Control: no-store.
// Identifier-only payload (ADR 0030) — no review text, emails, or tokens.
//
// BQC-5.5 (STD-P1-04): the route no longer constructs DB/Redis readers — it
// consumes the composition-owned OperationsSnapshot, which owns health-checker
// construction, queue-depth/heartbeat reads, per-section time budgets, and
// degrade-not-abort assembly. Unauthenticated by design (catalogue auth
// 'none'; operator runbooks curl it) — authorization at this boundary is
// BQC-7's gate.
import { createFileRoute } from '@tanstack/react-router'
import { getContainer } from '#/composition'

export const Route = createFileRoute('/api/health/metrics')({
  server: {
    handlers: {
      GET: async () => {
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
