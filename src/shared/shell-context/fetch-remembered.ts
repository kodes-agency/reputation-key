// One remembered shell answer: asked once, kept for `SHELL_CONTEXT_STALE_MS`.

import { isCancelledError, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { SHELL_CONTEXT_STALE_MS } from '#/shared/queries/shell-context-cache'

/**
 * Reads `queryKey` from the browser's cache, asking `ask` when there is no fresh
 * entry. `retry: false`, as the direct server calls were: a failure is decided at
 * once, never retried behind the person's click, and a rejected fetch keeps no data,
 * so it is asked again next time.
 *
 * A forget (`removeQueries`, `clear`) while the fetch is out cancels it, and Query
 * then rejects with a `CancelledError` that is nothing the server said. The answer is
 * asked for again, directly and unremembered: whatever caused the forget has changed
 * what is true, and the next navigation asks afresh.
 */
export async function fetchRemembered<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  ask: () => Promise<T>,
): Promise<T> {
  try {
    return await queryClient.fetchQuery({
      queryKey,
      queryFn: ask,
      staleTime: SHELL_CONTEXT_STALE_MS,
      retry: false,
    })
  } catch (error) {
    if (isCancelledError(error)) return ask()
    throw error
  }
}
