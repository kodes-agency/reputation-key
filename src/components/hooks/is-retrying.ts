// A region that failed to load stays on screen, its "Try again" busy, until the
// retry answers. TanStack Query does not do that by itself: a query that has no
// data resets to `pending` (and drops its error) the moment it refetches, so a
// panel keyed on `isError` is replaced by the loading skeleton and the button the
// person pressed leaves the page, taking keyboard focus with it. These two read
// the query the way the panel needs: it has failed, and a retry is reading.

type FailableQuery = Readonly<{
  isError: boolean
  isFetching: boolean
  /** Failures since the query was created; a refetch does not clear it. */
  errorUpdateCount: number
  data: unknown
}>

/**
 * The query failed and has nothing to show. Stays true while a retry reads, which
 * `isError` does not (it drops to false the moment the refetch starts).
 */
export function hasFailed(query: FailableQuery): boolean {
  if (query.isError) return true
  return query.isFetching && query.errorUpdateCount > 0 && query.data === undefined
}

/** A failed query is being tried again: show the failure, its button busy. */
export function isRetrying(
  ...queries: ReadonlyArray<FailableQuery | readonly FailableQuery[]>
): boolean {
  return queries.flat().some((query) => query.isFetching && hasFailed(query))
}
