// Whether a "Try again" is reading. TanStack Query keeps a query in its error
// state while it refetches after a failure (`isError` stays true, `isFetching`
// turns on), so a region that failed stays on screen, its button busy, until the
// answer comes. Pass every query the retry runs, or a list of them.

type RetryableQuery = Readonly<{ isError: boolean; isFetching: boolean }>

export function isRetrying(
  ...queries: ReadonlyArray<RetryableQuery | readonly RetryableQuery[]>
): boolean {
  return queries.flat().some((query) => query.isError && query.isFetching)
}
