// The monitoring client is a PARAMETER here, never an import.
//
// Two of the four sidecars are forbidden from linking one at all: the AI
// egress gateway and the AI execution admission service are the boundary that
// decides what may leave the cell, and `scripts/verify-ai-runtime-image.mjs`
// refuses any AI image whose bundle contains `node_modules/@sentry/` or whose
// environment carries a `SENTRY_DSN`. A module-level import of
// `shared/observability/telemetry` here linked the SDK into both AI bundles
// through this file, because `noExternal: [/.*/]` bundles everything
// statically reachable — the image gate caught it, which is what it is for.
//
// The types are still imported, as types: `import type` is erased, so the
// contract stays shared while the implementation is named by each entry point
// (`sidecar-monitored-observability` for the Google pair,
// `sidecar-unmonitored-observability` for the AI pair). A new sidecar cannot
// inherit a monitoring client it never asked for, because there is no default.
import type {
  ErrorCaptureContext,
  ObservabilityInitResult,
} from '../src/shared/observability/telemetry'
import {
  createSidecarProcessLifecycle,
  type SidecarLifecycleEvent,
  type SidecarProcessLifecycle,
  type SidecarServiceName,
  type SidecarTerminationTrigger,
} from './process-lifecycle'
import { adoptGitRevisionAsReleaseSha } from './sidecar-release-identity'

type SidecarProcessTarget = Readonly<{
  once(event: string, listener: (...arguments_: unknown[]) => void): unknown
  exit(code: 0 | 1): unknown
}>

type SidecarHealthDrain = Readonly<{
  beginDrain(): void
  stop(): Promise<void>
}>

export type SidecarObservability = Readonly<{
  initialize(service: SidecarServiceName): ObservabilityInitResult
  capture(error: unknown, context: ErrorCaptureContext): void
  flush(): Promise<boolean>
}>

export type SidecarStartupDependencies = SidecarObservability &
  Readonly<{ terminate?(code: 1): unknown }>

/**
 * Initialize the sidecar's own monitoring client before dynamically loading
 * any protected dependency. Startup failures use the same scrubbed error
 * boundary and bounded flush as process failures, then retain their original
 * exit semantics.
 *
 * `observability` is required. See the header: a default would decide for the
 * two sidecars that are not allowed to have one.
 */
export async function runSidecarStartup(
  service: SidecarServiceName,
  start: () => Promise<void>,
  observability: SidecarStartupDependencies,
): Promise<void> {
  try {
    // Before monitoring: the client tags every event with the release.
    adoptGitRevisionAsReleaseSha(process.env)
    observability.initialize(service)
    await start()
  } catch (error) {
    // ALWAYS say why, on stderr, before anything else. `capture` may be a
    // monitoring client that is switched off outside a deployed cell — the
    // Google sidecars' is — in which case the whole boundary is silent and the
    // container exits 1 with nothing to read. That is what a compose stack
    // reports as `dependency failed to start` and no reason.
    //
    // The message is included, and only here: a STARTUP failure happens before
    // the process has loaded anything tenant-scoped, so the error names a
    // configuration or a port, not a guest. Every later capture stays scrubbed.
    emitStartupFailure(service, error)
    try {
      observability.capture(error, {
        source: 'sidecar-startup',
        trigger: 'startup',
      })
    } catch {
      // Startup termination must not depend on the monitoring client.
    }
    try {
      await observability.flush()
    } catch {
      // Startup termination must remain bounded when monitoring is unavailable.
    }
    const terminate = observability.terminate ?? ((code: 1) => process.exit(code))
    terminate(1)
    throw new Error('sidecar startup termination returned unexpectedly', {
      cause: error,
    })
  }
}

function emitLifecycleEvent(event: SidecarLifecycleEvent): void {
  process.stderr.write(`${JSON.stringify(event)}\n`)
}

function emitStartupFailure(service: SidecarServiceName, error: unknown): void {
  const named = error instanceof Error ? error : undefined
  const code = (error as { code?: unknown } | null)?.code
  process.stderr.write(
    `${JSON.stringify({
      event: 'sidecar.startup_failed',
      service,
      name: named?.name ?? typeof error,
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
      message: named?.message ?? String(error),
    })}\n`,
  )
}

/**
 * Register one owner for process-fatal capture, readiness drain, protected
 * listener/resource cleanup, health-listener cleanup, monitoring flush, and
 * final exit. The lifecycle primitive ignores subsequent triggers, preventing
 * signal and fatal handlers from racing the same resources.
 */
export function registerSidecarOperationalLifecycle(
  input: Readonly<{
    service: SidecarServiceName
    health: SidecarHealthDrain
    shutdown: (trigger: SidecarTerminationTrigger) => Promise<void>
    shutdownTimeoutMs: number
    process?: SidecarProcessTarget
    /** Required for the same reason as runSidecarStartup's — see the header. */
    capture: SidecarObservability['capture']
    flush: SidecarObservability['flush']
    emit?: (event: SidecarLifecycleEvent) => void
  }>,
): SidecarProcessLifecycle {
  const processTarget = input.process ?? process
  const { capture, flush } = input

  const lifecycle = createSidecarProcessLifecycle({
    service: input.service,
    shutdownTimeoutMs: input.shutdownTimeoutMs,
    emit: input.emit ?? emitLifecycleEvent,
    exit: (code) => processTarget.exit(code),
    shutdown: async (trigger) => {
      input.health.beginDrain()
      let failure: unknown
      try {
        await input.shutdown(trigger)
      } catch (error) {
        failure = error
      }
      try {
        await input.health.stop()
      } catch (error) {
        failure ??= error
      }
      if (failure !== undefined) {
        capture(failure, { source: 'sidecar-process', trigger: 'shutdown' })
      }
      await flush()
      if (failure !== undefined) throw failure
    },
  })

  let terminationRequested = false
  const requestSignal = (signal: 'SIGTERM' | 'SIGINT') => {
    if (terminationRequested) return
    terminationRequested = true
    lifecycle.onSignal(signal)
  }
  processTarget.once('SIGTERM', () => requestSignal('SIGTERM'))
  processTarget.once('SIGINT', () => requestSignal('SIGINT'))
  processTarget.once('unhandledRejection', (reason) => {
    if (terminationRequested) return
    terminationRequested = true
    capture(reason, {
      source: 'sidecar-process',
      trigger: 'unhandledRejection',
    })
    lifecycle.onUnhandledRejection(reason)
  })
  processTarget.once('uncaughtException', (error) => {
    if (terminationRequested) return
    terminationRequested = true
    capture(error, {
      source: 'sidecar-process',
      trigger: 'uncaughtException',
    })
    lifecycle.onUncaughtException(error)
  })

  return lifecycle
}
