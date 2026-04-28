import { QueryClient } from '@tanstack/react-query'

/** Get or create a QueryClient.
 * On the server (SSR), always create a fresh instance per request.
 * On the client, reuse a singleton to preserve cache across navigations. */

let _queryClient: QueryClient | undefined

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
    },
  })
}

export function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always fresh
    return makeQueryClient()
  }
  // Client: singleton
  if (!_queryClient) {
    _queryClient = makeQueryClient()
  }
  return _queryClient
}

export function getContext() {
  const queryClient = getQueryClient()
  return { queryClient }
}

export default function TanstackQueryProvider() {}
