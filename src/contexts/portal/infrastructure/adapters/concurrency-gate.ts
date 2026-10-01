// Portal context — a bound on how many tasks run at once; the rest wait their turn.

export type ConcurrencyGate = <T>(task: () => Promise<T>) => Promise<T>

export function createConcurrencyGate(limit: number): ConcurrencyGate {
  let running = 0
  const waiting: Array<() => void> = []
  return async (task) => {
    if (running >= limit) await new Promise<void>((resume) => waiting.push(resume))
    running += 1
    try {
      return await task()
    } finally {
      running -= 1
      waiting.shift()?.()
    }
  }
}
