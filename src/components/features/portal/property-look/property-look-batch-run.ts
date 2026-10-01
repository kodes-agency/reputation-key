// The two bits of async plumbing the batch publish needs, kept free of React so
// tests can pin them: a publish that splits a long list into the requests the
// server accepts, and a read that keeps a few requests in flight, not fifty.

/** Run `work` over `items`, at most `limit` at a time; answers in the order of `items`. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export type BatchRun<O> = Readonly<{
  /** What each request that was answered said, in order. */
  outcomes: readonly O[]
  /** The refusal that stopped the run, or null when every request was answered. */
  error: unknown
}>

/**
 * Publish `ids` in requests of at most `size`, in order. A request that is
 * refused as a whole stops the run: the portals before it were published and
 * their outcomes are kept, those after it were not touched.
 */
export async function publishInBatches<O>(
  ids: readonly string[],
  publish: (batch: readonly string[]) => Promise<readonly O[]>,
  size: number,
): Promise<BatchRun<O>> {
  const outcomes: O[] = []
  for (let start = 0; start < ids.length; start += size) {
    try {
      outcomes.push(...(await publish(ids.slice(start, start + size))))
    } catch (error) {
      return { outcomes, error }
    }
  }
  return { outcomes, error: null }
}
