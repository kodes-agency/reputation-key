// How a route loader holds the page for a side read.
//
// A side read (the figures beside a list, a setup strip, a headline sentence) is
// started by the loader, which waits for it at most a grace and then lets the page
// draw without it: the page reads the same query with `useQuery` and draws a
// placeholder while it is pending. In the browser that is the whole story, the read
// goes on in the background and the page fills in when it lands.
//
// On the server it is not. The read stays in the request's QueryClient, still
// pending, and `@tanstack/react-router-ssr-query` sends that client to the browser:
// once every loader is done it dehydrates every query the client holds (a pending one
// with its promise), and until the render ends it streams each query it has not sent
// yet as soon as it has an answer. The server's HTML has the placeholder, the browser
// is handed the answer, and when the answer is there before the page hydrates the
// browser's first render draws the figures where the server drew the placeholder:
// React error 418, after which React throws the server's markup away and renders the
// page again in the browser. A slow machine does it: measured on 2026-10-28,
// Properties with the fleet read held 1.5 s and the scripts held 3.5 s failed in 8
// loads of 8.
//
// So when the grace ends on the server, a read of the loader's that is still pending
// is dropped from the client, here, in the loader. It has to be here: a read the
// integration finds pending goes to the browser with its promise, and dropping it
// afterwards makes that promise fail. The browser finds nothing for the read, draws
// the placeholder the server drew, and starts the read itself once the page is
// hydrated. This module imports only Query's types because route options are
// first-paint code.
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'

const isPending = (query: Query): boolean => query.state.status === 'pending'

/**
 * Waits for `reads`, the loader's side reads, at most `graceMs`. On the server, a
 * query under one of `keys` that is still pending when the grace ends is removed
 * from `queryClient` (its answer is thrown away when it comes) and a settled one
 * stays. In the browser nothing is removed and the read goes on in the background.
 *
 * `keys` are prefixes of what the loader's own reads are stored under. The loader
 * names them itself because the module that starts the reads loads on demand. Name
 * only the loader's own side reads: a read the page needs (the layout's property,
 * the page's own blocking reads) can be pending when the grace ends too, and must
 * stay. A read that only starts after the grace (its module is still loading) is
 * not in the cache to drop. `reads` never rejects: whoever starts a side read
 * catches or settles its failure, which the page shows in its own place and never
 * as an error.
 */
export async function primeWithinGrace(
  queryClient: QueryClient,
  reads: Promise<unknown>,
  keys: ReadonlyArray<QueryKey>,
  graceMs: number,
): Promise<void> {
  let graceEnded = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const grace = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      graceEnded = true
      resolve()
    }, graceMs)
  })
  await Promise.race([reads, grace])
  clearTimeout(timer)
  if (!graceEnded || typeof document !== 'undefined') return
  for (const queryKey of keys) {
    queryClient.removeQueries({ queryKey, predicate: isPending })
  }
}
