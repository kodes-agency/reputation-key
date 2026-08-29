// Observability for the sidecars that may not link a monitoring client: the
// AI egress gateway and the AI execution admission service.
//
// These two ARE the egress boundary. An SDK that opens its own outbound
// connection from inside the process deciding what may leave the cell is a
// hole in the thing being decided, so `scripts/verify-ai-runtime-image.mjs`
// refuses an AI image whose bundle contains `node_modules/@sentry/` or whose
// environment carries a `SENTRY_DSN`.
//
// Losing the client must not mean losing the signal. Failures are written to
// stderr as one JSON line — the same channel and shape the lifecycle events
// use, which the platform already collects — carrying the error NAME, the
// error `code` when there is one, and the capture context. Never the message
// and never the stack: an unscrubbed error body is exactly the tenant content
// this boundary exists to keep inside the cell.

import type { ErrorCaptureContext } from '../src/shared/observability/telemetry'
import type { SidecarStartupDependencies } from './sidecar-operational-runtime'

function scrubbed(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { name: typeof error }
  const code = (error as { code?: unknown }).code
  return {
    name: error.name,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
  }
}

export const unmonitoredSidecarObservability: SidecarStartupDependencies = Object.freeze({
  // Nothing to initialize, and saying so is the point: the boot report reads
  // 'disabled' rather than 'failed', because no client was meant to start.
  initialize: () => 'disabled' as const,
  capture: (error: unknown, context: ErrorCaptureContext) => {
    process.stderr.write(
      `${JSON.stringify({ event: 'sidecar.error', err: scrubbed(error), ...context })}\n`,
    )
  },
  // Stderr is already flushed by the write above; resolving true keeps the
  // bounded-shutdown contract honest instead of pretending to await a client.
  flush: async () => true,
  terminate: (code: 1) => process.exit(code),
})
