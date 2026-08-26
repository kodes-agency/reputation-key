export type WorkerTerminationTrigger =
  'SIGTERM' | 'SIGINT' | 'unhandledRejection' | 'uncaughtException'

type WorkerExitCode = 0 | 1

export type WorkerProcessFailureLogger = Readonly<{
  fatal: (obj: Record<string, unknown>, message: string) => void
}>

export type WorkerProcessFailurePolicy = Readonly<{
  onSignal: (signal: 'SIGTERM' | 'SIGINT') => void
  onUnhandledRejection: (reason: unknown) => void
  onUncaughtException: (error: Error) => void
}>

function safeUnhandledReason(reason: unknown): Error {
  // Real Error objects pass through the central logger sanitizer, which keeps
  // only name/code. Primitive/object rejection values may themselves be
  // secrets or payloads, so never forward or interpolate them.
  return reason instanceof Error ? reason : new Error('Non-Error rejection')
}

/**
 * One process-level termination owner for the worker. Signals drain cleanly;
 * unhandled asynchronous failures drain within the same budget and exit 1.
 * Only the first trigger wins so a second signal/error cannot start a second
 * close sequence against the same BullMQ resources.
 */
export function createWorkerProcessFailurePolicy(deps: {
  readonly shutdown: (
    trigger: WorkerTerminationTrigger,
    exitCode: WorkerExitCode,
  ) => Promise<void>
  readonly exit: (code: 1) => unknown
  readonly logger: WorkerProcessFailureLogger
  readonly captureFatal: (
    error: Error,
    trigger: WorkerTerminationTrigger | 'shutdown',
  ) => void
  readonly flushErrorMonitoring: () => Promise<boolean>
}): WorkerProcessFailurePolicy {
  let terminationRequested = false

  const requestTermination = (
    trigger: WorkerTerminationTrigger,
    exitCode: WorkerExitCode,
    failure?: unknown,
  ): void => {
    if (terminationRequested) return
    terminationRequested = true

    if (failure !== undefined) {
      const safeFailure = safeUnhandledReason(failure)
      deps.captureFatal(safeFailure, trigger)
      deps.logger.fatal(
        { err: safeFailure, trigger },
        'Fatal worker process error — starting bounded drain',
      )
    }

    void deps.shutdown(trigger, exitCode).catch(async (error: unknown) => {
      const safeError = safeUnhandledReason(error)
      deps.captureFatal(safeError, 'shutdown')
      deps.logger.fatal(
        { err: safeError, trigger },
        'Worker shutdown failed — forcing non-zero exit',
      )
      await deps.flushErrorMonitoring()
      deps.exit(1)
    })
  }

  return {
    onSignal: (signal) => requestTermination(signal, 0),
    onUnhandledRejection: (reason) => requestTermination('unhandledRejection', 1, reason),
    onUncaughtException: (error) => requestTermination('uncaughtException', 1, error),
  }
}
