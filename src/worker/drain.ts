// Worker drain — budgeted graceful shutdown for the BullMQ process.
//
// Every worker is asked to close at once: BullMQ's Worker.close() is what stops
// a worker fetching, and it then waits for its in-flight jobs. Closing them one
// after another would leave the later workers taking new jobs while the first
// drains, and every job they had started would be cut off when the budget ends
// the process. The container's own resources release next, then the shared
// resources the caller names, in order. The whole drain has one hard time
// budget: a hung job makes Worker.close() hang, which would let a deploy stall
// until the platform's SIGKILL. When the budget fires, the caller exits nonzero
// so the platform records an unclean stop (Railway's drainingSeconds is the
// outer bound; DRAIN_BUDGET_MS must stay below it).

import { disposeResources, type DisposalResult } from '#/shared/lifecycle/disposer'

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

/** The container's own release seam: the worker built the container, so the drain releases it. */
export interface ContainerRelease {
  readonly run: () => Promise<void>
}

/** `failed` names the closes that rejected; `stuck` the labels unfinished when the budget fired. */
export type DrainResult = DisposalResult

/**
 * Close the workers together, release the container, then close `resources` in
 * the order given. Undefined entries (lanes that were never started) are
 * skipped silently. A rejecting close is logged and does not stop the sequence;
 * it is reported in `failed` so the caller can exit nonzero. The whole sequence
 * races `budgetMs`; on expiry the labels not yet closed are reported in
 * `stuck`. The loop itself is not cancellable — a hung close keeps its promise
 * pending in the background until the process exits.
 */
export function drainWorkerResources(options: {
  readonly workers: ReadonlyArray<NamedCloseable | undefined>
  readonly resources: ReadonlyArray<NamedCloseable | undefined>
  readonly shutdown?: ContainerRelease
  readonly budgetMs: number
  readonly logger: DrainLogger
}): Promise<DrainResult> {
  const { logger, shutdown } = options
  const hook = (item: NamedCloseable, closed: string, failed: string) => ({
    label: item.label,
    release: async () => {
      try {
        await item.close()
        logger.info({ queue: item.label }, closed)
      } catch (err) {
        logger.error({ err, queue: item.label }, failed)
        throw err
      }
    },
  })
  const present = (items: ReadonlyArray<NamedCloseable | undefined>) =>
    items.filter((item): item is NamedCloseable => item !== undefined)
  const container: NamedCloseable[] = shutdown
    ? [{ label: 'container', close: () => shutdown.run() }]
    : []
  return disposeResources(
    [
      present(options.workers).map((worker) =>
        hook(worker, 'Worker drained successfully', 'Error draining worker'),
      ),
      ...container.map((item) => [
        hook(item, 'Container resources released', 'Error releasing container resources'),
      ]),
      ...present(options.resources).map((resource) => [
        hook(resource, 'Resource closed successfully', 'Error closing resource'),
      ]),
    ],
    { budgetMs: options.budgetMs },
  )
}
