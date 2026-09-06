export type SidecarServiceName = 'ai-execution-admission' | 'ai-egress-gateway'

export type SidecarTerminationTrigger =
  'SIGTERM' | 'SIGINT' | 'unhandledRejection' | 'uncaughtException'

type SafeErrorIdentity = Readonly<{
  errorClass: string
  errorCode?: string
}>

export type SidecarLifecycleEvent =
  | Readonly<{
      event: 'sidecar_shutdown_requested' | 'sidecar_shutdown_completed'
      service: SidecarServiceName
      trigger: SidecarTerminationTrigger
      exitCode: 0 | 1
    }>
  | (Readonly<{
      event: 'sidecar_fatal_process_error' | 'sidecar_shutdown_failed'
      service: SidecarServiceName
      trigger: SidecarTerminationTrigger
    }> &
      SafeErrorIdentity)
  | Readonly<{
      event: 'sidecar_shutdown_timed_out'
      service: SidecarServiceName
      trigger: SidecarTerminationTrigger
      timeoutMs: number
    }>

export type SidecarProcessLifecycle = Readonly<{
  onSignal(signal: 'SIGTERM' | 'SIGINT'): void
  onUnhandledRejection(reason: unknown): void
  onUncaughtException(error: unknown): void
  /** Test/embedding seam; process entrypoints normally terminate via exit(). */
  whenSettled(): Promise<void>
}>

const SAFE_ERROR_CLASSES = new Set([
  'AbortError',
  'AggregateError',
  'DatabaseError',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'ReplyError',
  'SyntaxError',
  'TimeoutError',
  'TypeError',
  'URIError',
])

const SAFE_ERROR_CODES = new Set([
  'EACCES',
  'EADDRINUSE',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
])

function safeErrorIdentity(error: unknown): SafeErrorIdentity {
  if (!(error instanceof Error)) return { errorClass: 'NonErrorRejection' }
  const errorClass = SAFE_ERROR_CLASSES.has(error.name) ? error.name : 'Error'
  const rawCode = (error as Error & { code?: unknown }).code
  return {
    errorClass,
    ...(typeof rawCode === 'string' && SAFE_ERROR_CODES.has(rawCode)
      ? { errorCode: rawCode }
      : {}),
  }
}

/**
 * One bounded process-termination owner for mTLS sidecars. Signals drain and
 * exit zero; uncaught failures are represented only by a sanitized identity,
 * run the same drain, and exit non-zero. A second trigger is ignored so two
 * close sequences can never race the same server, pool, Redis client, or key.
 */
export function createSidecarProcessLifecycle(input: {
  readonly service: SidecarServiceName
  readonly shutdown: (trigger: SidecarTerminationTrigger) => Promise<void>
  readonly shutdownTimeoutMs: number
  readonly emit: (event: SidecarLifecycleEvent) => void
  readonly exit: (code: 0 | 1) => unknown
}): SidecarProcessLifecycle {
  if (
    !Number.isSafeInteger(input.shutdownTimeoutMs) ||
    input.shutdownTimeoutMs < 1 ||
    input.shutdownTimeoutMs > 300_000
  ) {
    throw new Error('sidecar shutdown timeout is invalid')
  }

  let requested = false
  const settled = Promise.withResolvers<void>()
  const emit = (event: SidecarLifecycleEvent) => {
    try {
      input.emit(event)
    } catch {
      // A diagnostic sink must never replace the owned shutdown/exit path.
    }
  }

  const requestTermination = (
    trigger: SidecarTerminationTrigger,
    exitCode: 0 | 1,
    failure?: unknown,
  ) => {
    if (requested) return
    requested = true
    if (failure !== undefined) {
      emit({
        event: 'sidecar_fatal_process_error',
        service: input.service,
        trigger,
        ...safeErrorIdentity(failure),
      })
    }
    emit({
      event: 'sidecar_shutdown_requested',
      service: input.service,
      trigger,
      exitCode,
    })

    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const shutdown = Promise.resolve()
        .then(() => input.shutdown(trigger))
        .then(
          () => ({ kind: 'completed' as const }),
          (error: unknown) => ({ kind: 'failed' as const, error }),
        )
      const timeout = new Promise<{ kind: 'timed_out' }>((resolve) => {
        timer = setTimeout(
          () => resolve({ kind: 'timed_out' as const }),
          input.shutdownTimeoutMs,
        )
        timer.unref()
      })
      try {
        const outcome = await Promise.race([shutdown, timeout])
        if (outcome.kind === 'completed') {
          emit({
            event: 'sidecar_shutdown_completed',
            service: input.service,
            trigger,
            exitCode,
          })
          input.exit(exitCode)
          return
        }
        if (outcome.kind === 'failed') {
          emit({
            event: 'sidecar_shutdown_failed',
            service: input.service,
            trigger,
            ...safeErrorIdentity(outcome.error),
          })
        } else {
          emit({
            event: 'sidecar_shutdown_timed_out',
            service: input.service,
            trigger,
            timeoutMs: input.shutdownTimeoutMs,
          })
        }
        input.exit(1)
      } finally {
        clearTimeout(timer)
        settled.resolve()
      }
    })()
  }

  return {
    onSignal: (signal) => requestTermination(signal, 0),
    onUnhandledRejection: (reason) => requestTermination('unhandledRejection', 1, reason),
    onUncaughtException: (error) => requestTermination('uncaughtException', 1, error),
    whenSettled: () => settled.promise,
  }
}
