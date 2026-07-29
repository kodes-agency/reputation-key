// Web graceful-shutdown orchestrator (BQC-7.1).
//
// The production web entry (nitro node-server preset) drains HTTP via srvx's
// graceful plugin (SIGTERM/SIGINT → stop accepting, 5s in-flight budget,
// SERVER_SHUTDOWN_TIMEOUT override) but never closes app resources — the pg
// pool and Redis/BullMQ connections keep the event loop alive, so today the
// process only dies when the platform SIGKILLs it after drainingSeconds.
// This module closes the app resources, each raced against a budget, so the
// event loop empties and the process exits naturally and promptly.
//
// It deliberately does NOT call process.exit: srvx owns the HTTP drain and
// runs in parallel — exiting early would cut in-flight requests. A resource
// that refuses to close within its budget is logged and abandoned (the
// platform's SIGKILL remains the outer bound, same posture as before).
//
// Wired by server/plugins/graceful-shutdown.ts (nitro runtime plugin,
// registered via the `plugins` array in vite.config.ts — serverDir scanning
// stays off, so the inert security-headers plugin is unaffected).

export interface NamedCloser {
  readonly name: string
  readonly close: () => Promise<void>
}

/** Narrow structural subset of the pino logger used by the shutdown path. */
export interface ShutdownLogger {
  info: (obj: Record<string, unknown>, msg: string) => void
  error: (obj: Record<string, unknown>, msg: string) => void
}

export interface CloseFailure {
  readonly name: string
  readonly reason: 'timeout' | 'error'
}

/**
 * Close each resource in order, racing every close against `budgetMs`.
 * Closers run sequentially: the BullMQ queue Redis connection goes first so
 * the shared cache client stays usable for late in-flight requests, the pg
 * pool last (it waits for checked-out clients anyway). Returns the resources
 * that failed or timed out — never throws.
 */
export async function closeWebResources(
  closers: ReadonlyArray<NamedCloser>,
  options: { readonly budgetMs: number; readonly logger: ShutdownLogger },
): Promise<ReadonlyArray<CloseFailure>> {
  const { budgetMs, logger } = options
  const failures: CloseFailure[] = []

  for (const closer of closers) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const budget = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), budgetMs)
    })
    const outcome = await Promise.race([
      closer.close().then(
        () => 'closed' as const,
        (err: unknown) => ({ err }),
      ),
      budget,
    ])
    clearTimeout(timer)

    if (outcome === 'closed') {
      logger.info({ resource: closer.name }, 'Resource closed during shutdown')
    } else if (outcome === 'timeout') {
      failures.push({ name: closer.name, reason: 'timeout' })
      logger.error(
        { resource: closer.name, budgetMs },
        'Resource close timed out during shutdown — abandoning (platform SIGKILL bounds the rest)',
      )
    } else {
      failures.push({ name: closer.name, reason: 'error' })
      logger.error(
        { err: outcome.err, resource: closer.name },
        'Error closing resource during shutdown',
      )
    }
  }

  return failures
}
