// Job handler registry — maps job names to handler functions.
// Per architecture: "No classes. Records of functions returned by factories."

import type { Job } from 'bullmq'

export type JobHandler<T = unknown, TResult = unknown> = (job: Job<T>) => Promise<TResult>

export type JobRegistry = Readonly<{
  /** Register a handler for a job name. */
  register(name: string, handler: JobHandler): void
  /** Get the handler for a job name, or undefined. */
  getHandler(name: string): JobHandler | undefined
  /** Get all registered handlers. */
  getAll(): ReadonlyMap<string, JobHandler>
}>

export function createJobRegistry(): JobRegistry {
  const handlers = new Map<string, JobHandler>()

  return {
    register(name: string, handler: JobHandler): void {
      if (handlers.has(name)) {
        throw new Error(`Job handler "${name}" is already registered`)
      }
      handlers.set(name, handler)
    },

    getHandler(name: string): JobHandler | undefined {
      return handlers.get(name)
    },

    getAll(): ReadonlyMap<string, JobHandler> {
      return new Map(handlers)
    },
  }
}
