// In-memory BullMQ Queue fake — records every add() and optionally runs
// handlers inline for deterministic, Redis-free job processing.
//
// Implements the same Queue interface so the container can't tell the difference.
// Used by createSimulationContainer (ADR 0019) to exercise the full reactive
// pipeline without Redis/BullMQ.

import type { Queue, Job } from 'bullmq'
import type { JobRegistry } from '#/shared/jobs/registry'
import type { Clock } from '#/shared/domain/clock'

// fallow-ignore-next-line unused-type
export type InMemoryQueue = Queue & {
  /** All jobs enqueued since the last clear, as { name, data } pairs. */
  readonly enqueuedJobs: ReadonlyArray<Readonly<{ name: string; data: unknown }>>
  /** Jobs that were processed inline (handler ran). */
  readonly processedJobs: ReadonlyArray<Readonly<{ name: string; data: unknown }>>
  /** Clear all recorded jobs. */
  clear: () => void
  /** Late-bind the job registry for inline processing (after container build). */
  connectRegistry: (registry: JobRegistry) => void
}

export type InMemoryQueueOptions = {
  /** When provided, jobs are processed inline by looking up handlers. */
  registry?: JobRegistry
  /** Clock for job timestamps. */
  clock?: Clock
}

export function createInMemoryQueue(options?: InMemoryQueueOptions): InMemoryQueue {
  const enqueued: Array<{ name: string; data: unknown }> = []
  const processed: Array<{ name: string; data: unknown }> = []
  const clock = options?.clock ?? (() => new Date())
  // Late-bindable registry — set after container construction via connectRegistry
  let registry = options?.registry

  const queue = {
    async add(name: string, data: unknown): Promise<Job> {
      enqueued.push({ name, data })

      // If a registry is available, run the handler inline
      if (registry) {
        const handler = registry.getHandler(name)
        if (handler) {
          const fakeJob = {
            id: `inmem-${enqueued.length}`,
            name,
            data,
            timestamp: clock().getTime(),
            attemptsMade: 1,
            attemptsStarted: 1,
          } as unknown as Job
          await handler(fakeJob)
          processed.push({ name, data })
        }
      }

      return { id: `inmem-${enqueued.length}` } as unknown as Job
    },

    get enqueuedJobs() {
      return [...enqueued]
    },

    get processedJobs() {
      return [...processed]
    },

    clear() {
      enqueued.length = 0
      processed.length = 0
    },

    // BullMQ Queue stubs — not used in simulation but satisfy the type
    close: async () => undefined,
    pause: async () => undefined,
    resume: async () => undefined,
    obliterate: async () => undefined,
    getJob: async () => null,
    connectRegistry(reg: JobRegistry) {
      registry = reg
    },
  }

  return queue as unknown as InMemoryQueue
}
