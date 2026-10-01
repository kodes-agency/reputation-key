// Portal context — a bound on how many tasks run at once; the rest wait their turn.

export type ConcurrencyGate = <T>(task: () => Promise<T>) => Promise<T>

export function createConcurrencyGate(limit: number): ConcurrencyGate {
  let running = 0
  const waiting: Array<() => void> = []
  return async (task) => {
    if (running >= limit) {
      // The place is handed over by whoever frees it, already counted, so
      // nobody arriving in the meantime can take it.
      await new Promise<void>((resume) => waiting.push(resume))
    } else {
      running += 1
    }
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else running -= 1
    }
  }
}
