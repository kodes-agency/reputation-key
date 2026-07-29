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

/** Narrow structural subset of the pino logger used by the drain loop. */
export interface DrainLogger {
  info: (obj: Record<string, unknown>, msg: string) => void
  error: (obj: Record<string, unknown>, msg: string) => void
}

export interface DrainResult {
  /** True when the budget fired before every resource finished closing. */
  readonly timedOut: boolean
  /** Labels not yet closed when the budget fired (in-flight first). */
  readonly stuck: ReadonlyArray<string>
}

/**
 * Close workers, then queues, in the given order. A rejecting close is logged
 * and does not stop the sequence (mirrors the pre-BQC-7.1 inline loop). The
 * whole sequence races `budgetMs`; on expiry the still-open labels are
 * reported. The loop itself is not cancellable — a hung close keeps its
 * promise pending in the background until the process exits.
 */
export async function drainWorkerResources(options: {
  readonly workers: ReadonlyArray<NamedCloseable>
  readonly queues: ReadonlyArray<NamedCloseable>
  readonly budgetMs: number
  readonly logger: DrainLogger
}): Promise<DrainResult> {
  const { workers, queues, budgetMs, logger } = options
  const remaining = [...workers, ...queues].map((r) => r.label)

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
