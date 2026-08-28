// Worker drain (BQC-7.1) — budgeted graceful shutdown for the BullMQ process.
//
// Extracted from src/worker/index.ts so the budget path is unit-testable.
// The happy path is behavior-identical to the pre-extraction inline loop:
// workers close sequentially (BullMQ Worker.close() stops fetching and drains
// in-flight jobs), then queues close sequentially, each step logged with the
// same messages. The addition is a hard time budget: a hung job makes
// Worker.close() hang forever, which previously let a deploy stall until the
// platform's SIGKILL. When the budget fires, the caller exits non-zero so the
// platform records an unclean stop (Railway drainingSeconds is the outer
// bound; DRAIN_BUDGET_MS must stay below it).

export interface NamedCloseable {
  readonly label: string
  readonly close: () => Promise<void>
}

/**
 * Map an optional BullMQ worker/queue to a NamedCloseable, or undefined when
 * the resource was never created (no Redis, or the gated domain-events lane).
 * Lives here (not inline in the entry point) so the mapping is unit-tested —
 * the worker entry point itself has no hermetic coverage path.
 */
export function namedCloseable<T extends { close(): Promise<void> }>(
  label: string,
  resource: T | undefined,
): NamedCloseable | undefined {
  return resource ? { label, close: () => resource.close() } : undefined
}

/** Narrow structural subset of the pino logger used by the drain loop. */
export interface DrainLogger {
  info: (obj: Record<string, unknown>, msg: string) => void
  error: (obj: Record<string, unknown>, msg: string) => void
}

/**
 * The container's own release seam (ARC-03-T6). The worker owns the container
 * it built, so the drain — not the process exit — is what stops the
 * container's background work.
 */
export interface ContainerRelease {
  readonly run: () => Promise<void>
}

/** Budget/reporting label for the container release step. */
const CONTAINER_LABEL = 'container'

export interface DrainResult {
  /** True when the budget fired before every resource finished closing. */
  readonly timedOut: boolean
  /** Labels not yet closed when the budget fired (in-flight first). */
  readonly stuck: ReadonlyArray<string>
}

/**
 * Close workers, then queues, in the given order. Undefined entries (lanes
 * that were never started) are skipped silently, mirroring the pre-BQC-7.1
 * `if (w)` guards. A rejecting close is logged and does not stop the
 * sequence (mirrors the pre-BQC-7.1 inline loop). The whole sequence races
 * `budgetMs`; on expiry the still-open labels are reported. The loop itself
 * is not cancellable — a hung close keeps its promise pending in the
 * background until the process exits.
 *
 * ARC-03-T6: `shutdown` (the container's release seam) runs between the two
 * phases — after the workers stop taking jobs, before the queue connections
 * go away — because the container's background work (the identity policy
 * poller) reads the database and must not be left ticking against a closing
 * process. It shares the same budget as everything else.
 */
export async function drainWorkerResources(options: {
  readonly workers: ReadonlyArray<NamedCloseable | undefined>
  readonly queues: ReadonlyArray<NamedCloseable | undefined>
  readonly shutdown?: ContainerRelease
  readonly budgetMs: number
  readonly logger: DrainLogger
}): Promise<DrainResult> {
  const { budgetMs, logger, shutdown } = options
  const workers = options.workers.filter((w): w is NamedCloseable => w !== undefined)
  const queues = options.queues.filter((q): q is NamedCloseable => q !== undefined)
  const remaining = [
    ...workers.map((r) => r.label),
    ...(shutdown ? [CONTAINER_LABEL] : []),
    ...queues.map((r) => r.label),
  ]

  const loop = (async () => {
    for (const w of workers) {
      try {
        await w.close()
        logger.info({ queue: w.label }, 'Worker drained successfully')
      } catch (err) {
        logger.error({ err, queue: w.label }, 'Error draining worker')
      } finally {
        remaining.splice(remaining.indexOf(w.label), 1)
      }
    }
    if (shutdown) {
      try {
        await shutdown.run()
        logger.info({ queue: CONTAINER_LABEL }, 'Container resources released')
      } catch (err) {
        logger.error(
          { err, queue: CONTAINER_LABEL },
          'Error releasing container resources',
        )
      } finally {
        remaining.splice(remaining.indexOf(CONTAINER_LABEL), 1)
      }
    }
    for (const q of queues) {
      try {
        await q.close()
        logger.info({ queue: q.label }, 'Queue closed successfully')
      } catch (err) {
        logger.error({ err, queue: q.label }, 'Error closing queue')
      } finally {
        remaining.splice(remaining.indexOf(q.label), 1)
      }
    }
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), budgetMs)
  })
  const outcome = await Promise.race([loop.then(() => 'done' as const), budget])
  clearTimeout(timer)

  if (outcome === 'timeout') {
    return { timedOut: true, stuck: [...remaining] }
  }
  return { timedOut: false, stuck: [] }
}
