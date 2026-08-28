import {
  captureObservabilityException,
  flushObservability,
  initObservability,
  type ErrorCaptureContext,
  type ObservabilityInitResult,
} from '../src/shared/observability/telemetry'
import {
  createSidecarProcessLifecycle,
  type SidecarLifecycleEvent,
  type SidecarProcessLifecycle,
  type SidecarServiceName,
  type SidecarTerminationTrigger,
} from './process-lifecycle'

type SidecarProcessTarget = Readonly<{
  once(event: string, listener: (...arguments_: unknown[]) => void): unknown
  exit(code: 0 | 1): unknown
}>

type SidecarHealthDrain = Readonly<{
  beginDrain(): void
  stop(): Promise<void>
}>

type SidecarObservability = Readonly<{
  initialize(service: SidecarServiceName): ObservabilityInitResult
  capture(error: unknown, context: ErrorCaptureContext): void
  flush(): Promise<boolean>
}>

type SidecarStartupDependencies = SidecarObservability &
  Readonly<{ terminate?(code: 1): unknown }>

const DEFAULT_OBSERVABILITY: SidecarObservability = Object.freeze({
  initialize: initObservability,
  capture: captureObservabilityException,
  flush: () => flushObservability(),
})

const DEFAULT_STARTUP_DEPENDENCIES: SidecarStartupDependencies = Object.freeze({
  ...DEFAULT_OBSERVABILITY,
  terminate: (code) => process.exit(code),
})

/**
 * Initialize the supported Node monitoring SDK before dynamically loading any
 * protected sidecar dependencies. Startup failures use the same scrubbed error
 * boundary and bounded flush as process failures, then retain their original
 * exit semantics.
 */
export async function runSidecarStartup(
  service: SidecarServiceName,
  start: () => Promise<void>,
  observability: SidecarStartupDependencies = DEFAULT_STARTUP_DEPENDENCIES,
): Promise<void> {
  try {
    observability.initialize(service)
    await start()
  } catch (error) {
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
    const terminate = observability.terminate ?? DEFAULT_STARTUP_DEPENDENCIES.terminate
    terminate?.(1)
    throw new Error('sidecar startup termination returned unexpectedly', {
      cause: error,
    })
  }
}

function emitLifecycleEvent(event: SidecarLifecycleEvent): void {
  process.stderr.write(`${JSON.stringify(event)}\n`)
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
    capture?: SidecarObservability['capture']
    flush?: SidecarObservability['flush']
    emit?: (event: SidecarLifecycleEvent) => void
  }>,
): SidecarProcessLifecycle {
  const processTarget = input.process ?? process
  const capture = input.capture ?? captureObservabilityException
  const flush = input.flush ?? (() => flushObservability())

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
