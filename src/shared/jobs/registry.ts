// Job handler registry — maps job names to handler functions.
// Per architecture: "No classes. Records of functions returned by factories."

export type JobHandler<T = unknown> = (job: import('bullmq').Job<T>) => Promise<void>

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
