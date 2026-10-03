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
  /**
   * The portals of the request that threw, or none when every request was
   * answered. The server publishes a request's portals one by one, so a fault
   * partway through (a timeout, a dropped answer) leaves it unknown which of
   * them went live: they are not "untouched", only unconfirmed. The portals of
   * later requests were never sent.
   */
  unconfirmed: readonly string[]
  /** The fault that stopped the run, or null when every request was answered. */
  error: unknown
}>

/**
 * Publish `ids` in requests of at most `size`, in order. A request that is
 * refused as a whole stops the run: the portals before it were published and
 * their outcomes are kept, those of the request itself are unconfirmed, those
 * after it were not sent.
 */
export async function publishInBatches<O>(
  ids: readonly string[],
  publish: (batch: readonly string[]) => Promise<readonly O[]>,
  size: number,
): Promise<BatchRun<O>> {
  const outcomes: O[] = []
  for (let start = 0; start < ids.length; start += size) {
    const batch = ids.slice(start, start + size)
    try {
      outcomes.push(...(await publish(batch)))
    } catch (error) {
      return { outcomes, unconfirmed: batch, error }
    }
  }
  return { outcomes, unconfirmed: [], error: null }
}

/** What the dialog keeps of the runs so far. */
export type RunRecord<O> = Readonly<{
  /** The portals that were sent, in the order shown. */
  attempted: readonly string[]
  outcomes: readonly O[]
}>

/**
 * Fold the result of sending `sending` into what the runs before it left: a
 * retried portal's earlier outcome is replaced (never listed twice), the others
 * stay, and `order` (the portals as shown) says where each is listed.
 */
export function mergeRun<O extends Readonly<{ portalId: string }>>(
  before: RunRecord<O>,
  sending: readonly string[],
  result: BatchRun<O>,
  order: readonly string[],
): RunRecord<O> & Readonly<{ unconfirmed: readonly string[]; error: unknown }> {
  const sent = new Set(sending)
  const asked = new Set([...before.attempted, ...sending])
  return {
    attempted: order.filter((id) => asked.has(id)),
    outcomes: [
      ...before.outcomes.filter((o) => !sent.has(o.portalId)),
      ...result.outcomes,
    ],
    unconfirmed: result.unconfirmed,
    error: result.error,
  }
}
