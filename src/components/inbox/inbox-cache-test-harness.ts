// The harness of the Inbox cache suites: a real QueryClient mounted as in a
// browser, the reads the page keeps on screen, and the app's own hooks rendered
// under it.
//
// The unit project has no DOM, so a hook cannot be mounted and clicked. What it
// can do is what these suites need: render the hook once on the server
// renderer, take the Action it returned, and call it. The mutation runs through
// the real `useActionMutation` against the real client, and every read the
// suite mounts is an observer the client re-reads when a policy invalidates it.
//
// Shared by `inbox-command-fence*.test.ts` and `inbox-refusal-reread.test.ts`.
// Each suite still mocks `@tanstack/react-router` and `sonner` itself (a
// `vi.mock` is hoisted per test file) and brings its own server: this module is
// a component file to the boundary lint, so it cannot import the Storybook
// in-memory container the fence suites use. Test support only: nothing in the
// app imports it.

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  environmentManager,
  type InfiniteData,
} from '@tanstack/react-query'
import { afterEach, beforeEach, vi } from 'vitest'
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'
import { inboxKeys } from '#/shared/queries/query-keys'
import { INBOX_PAGE_SIZE } from './inbox-search-schema'
import type { InboxServerFns } from './types'

type ListPage = Awaited<ReturnType<InboxServerFns['getInboxItems']>>
export type ListFilters = Readonly<Record<string, unknown>>

/** The list query, keyed and fetched as `useInboxState` keys and fetches it. */
function listOptions(fns: InboxServerFns, filters: ListFilters, onRequest?: () => void) {
  return {
    queryKey: inboxKeys.list(filters),
    queryFn: () => {
      onRequest?.()
      return fns.getInboxItems({ data: { ...filters, limit: INBOX_PAGE_SIZE } })
    },
    initialPageParam: undefined,
    getNextPageParam: (last: ListPage) => last.nextCursor ?? undefined,
  }
}

/** Registers the per-test client and returns what a suite does with it. */
export function installInboxCacheHarness() {
  let client: QueryClient
  const mounted: Array<() => void> = []

  beforeEach(() => {
    vi.useFakeTimers()
    // Observers fetch only in a browser; the unit project runs in Node.
    environmentManager.setIsServer(() => false)
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    client.mount()
  })

  afterEach(() => {
    mounted.splice(0).forEach((unsubscribe) => unsubscribe())
    client.unmount()
    client.clear()
    environmentManager.setIsServer(() => typeof window === 'undefined')
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  const rows = (filters: ListFilters): ReadonlyArray<InboxItem> =>
    client
      .getQueryData<InfiniteData<ListPage>>(inboxKeys.list(filters))
      ?.pages.flatMap((page) => page.items) ?? []

  /** Keep a read on screen: mounted, so an invalidation re-reads it. */
  const mount = (
    queryKey: readonly unknown[],
    read: () => unknown,
    staleTime?: number,
  ): void => {
    const observer = new QueryObserver(client, { queryKey, queryFn: read, staleTime })
    mounted.push(observer.subscribe(() => {}))
  }

  return {
    get client() {
      return client
    },
    /** Let every started read and its notifications finish. */
    settle: () => vi.advanceTimersByTimeAsync(0),
    mount,
    /** A list that is on screen. */
    showList(fns: InboxServerFns, filters: ListFilters, onRequest?: () => void) {
      const observer = new InfiniteQueryObserver(
        client,
        listOptions(fns, filters, onRequest),
      )
      mounted.push(observer.subscribe(() => {}))
    },
    /** A list the manager opened earlier: cached, and not on screen. */
    cacheList: (fns: InboxServerFns, filters: ListFilters) =>
      client.fetchInfiniteQuery(listOptions(fns, filters)),
    /** The detail read of the open item, as `useInboxDetailQueries` issues it. */
    openItem: (fns: InboxServerFns, id: string) =>
      mount(
        inboxKeys.detail(id),
        () => fns.getInboxItemDetail({ data: { inboxItemId: id } }),
        0,
      ),
    rows,
    rowRevision: (filters: ListFilters, id: string) =>
      rows(filters).find((row) => row.id === id)?.commandRevision,
    detail: (id: string) =>
      client.getQueryData<InboxItemDetailResult>(inboxKeys.detail(id)),
    /** Render hooks once under the client and hand back what they returned. */
    renderHooks<T>(useHooks: () => T): T {
      const box: { current?: T } = {}
      function Harness() {
        box.current = useHooks()
        return null
      }
      renderToString(
        createElement(QueryClientProvider, { client }, createElement(Harness)),
      )
      if (box.current === undefined) throw new Error('the hook harness did not render')
      return box.current
    },
  }
}
