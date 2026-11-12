// The older list: the rows below the polled head, read by cursor.
//
// The head is the only notification read on a timer. The rows below it are
// read only when the reader asks ("Load more"), strictly after the head's
// last row, and kept in the query cache so the bell and the page keep them
// across remounts. Two rules keep them true without ever polling them:
//
//  - The list always continues the head it sits under. A head read whose last
//    row is no longer where the list starts (rows arrived above it, a row left
//    it, a coalesced row re-sorted to the top), or that proves loaded rows
//    stale, re-reads the list from the new head down to the depth already
//    loaded. A list that cannot be re-read goes, and "Load more" starts again
//    from the head: a gap in the middle of the list is worse than a shorter one.
//  - A write that may have changed rows nobody can patch (an Undo, a failed
//    write whose outcome is unknown) marks every older list of the
//    Organization for the next head read to re-read.
//
// Every change to one list (Load more, a re-read) runs one at a time, in the
// order asked, so a slower read can never land over a later one.

import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'
import {
  isStillWaiting,
  type NotificationFeedCursor,
  type NotificationFeedHead,
  type NotificationPage,
  type NotificationView,
} from '#/contexts/feed/application/public-api'

/** The server's largest page: a re-read covers loaded depth in as few reads as it can. */
const LARGEST_PAGE = 100

export type FetchNotificationPage = (
  before: NotificationFeedCursor,
  limit: number,
) => Promise<NotificationPage>

export type OlderNotifications = Readonly<{
  /** The head's last row when these rows were read: the list continues strictly after it. */
  from: NotificationFeedCursor
  rows: ReadonlyArray<NotificationView>
  /** Where the next page starts; null once the feed has no more rows. */
  nextCursor: NotificationFeedCursor | null
  isLoadingMore: boolean
  loadMoreError: Error | null
  /** Writes since which the rows may be stale; the next head read re-reads them. */
  staleWrites: number
}>

const sameFeedPosition = (
  a: NotificationFeedCursor | null | undefined,
  b: NotificationFeedCursor | null | undefined,
) => a?.at === b?.at && a?.id === b?.id

const isOlderList = (data: unknown): data is OlderNotifications =>
  typeof data === 'object' && data !== null && 'rows' in data && 'from' in data

const queues = new WeakMap<QueryClient, Map<string, Promise<void>>>()

/** Runs `task` after every change already asked of the same list. */
function inTurn(qc: QueryClient, key: QueryKey, task: () => Promise<void>) {
  const lists = queues.get(qc) ?? new Map<string, Promise<void>>()
  queues.set(qc, lists)
  const hash = hashKey(key)
  const turn = (lists.get(hash) ?? Promise.resolve()).then(task, task)
  lists.set(hash, turn)
  return turn.finally(() => {
    if (lists.get(hash) === turn) lists.delete(hash)
  })
}

const readOlder = (qc: QueryClient, key: QueryKey) => {
  const data = qc.getQueryData<OlderNotifications | null>(key)
  return isOlderList(data) ? data : null
}

/**
 * Asks for the next older page: after the list's last row, or after the
 * head's last row when nothing older is loaded yet. A failure stays on the
 * list (the rows the reader has keep showing) until Retry or the next re-read.
 */
export function loadOlderNotifications(
  qc: QueryClient,
  olderKey: QueryKey,
  headKey: QueryKey,
  fetchPage: FetchNotificationPage,
  limit: number,
): Promise<void> {
  return inTurn(qc, olderKey, async () => {
    const loaded = readOlder(qc, olderKey)
    const headEnd = qc.getQueryData<NotificationFeedHead>(headKey)?.page.nextCursor
    const after = loaded ? loaded.nextCursor : headEnd
    if (!after) return
    const asking: OlderNotifications = loaded
      ? { ...loaded, isLoadingMore: true, loadMoreError: null }
      : {
          from: after,
          rows: [],
          nextCursor: after,
          isLoadingMore: true,
          loadMoreError: null,
          staleWrites: 0,
        }
    qc.setQueryData(olderKey, asking)
    try {
      const page = await fetchPage(after, limit)
      const current = readOlder(qc, olderKey) ?? asking
      qc.setQueryData<OlderNotifications>(olderKey, {
        ...current,
        rows: [...current.rows, ...page.notifications],
        nextCursor: page.nextCursor,
        isLoadingMore: false,
      })
    } catch (error) {
      const current = readOlder(qc, olderKey) ?? asking
      qc.setQueryData<OlderNotifications>(olderKey, {
        ...current,
        isLoadingMore: false,
        loadMoreError: error instanceof Error ? error : new Error(String(error)),
      })
    }
  })
}

/**
 * True when the head proves the loaded rows stale without another request:
 * the head is the whole feed, so nothing below it exists; or the rows on
 * screen hold more still-waiting rows than the badge counts (a settled row
 * counts in neither), so some were read, dismissed or muted elsewhere.
 */
function provesStale(head: NotificationFeedHead, older: OlderNotifications): boolean {
  if (!head.page.hasMore) return true
  const waiting = mergeNotificationRows(head.page, older.rows).filter(isStillWaiting)
  return waiting.length > head.unreadCount
}

/** Reads from `from` until `depth` rows are covered or the feed ends. */
async function readDown(
  fetchPage: FetchNotificationPage,
  from: NotificationFeedCursor,
  depth: number,
  limit: number,
): Promise<Pick<OlderNotifications, 'rows' | 'nextCursor'>> {
  const rows: NotificationView[] = []
  let cursor: NotificationFeedCursor | null = from
  while (cursor && rows.length < depth) {
    const pageLimit = Math.min(LARGEST_PAGE, Math.max(limit, depth - rows.length))
    const page: NotificationPage = await fetchPage(cursor, pageLimit)
    rows.push(...page.notifications)
    cursor = page.nextCursor
  }
  return { rows, nextCursor: cursor }
}

/**
 * Brings a loaded older list in line with a head just read: unchanged when it
 * still continues that head and nothing marked it stale, otherwise re-read
 * from the head's last row down to the depth it had. A head that ends the
 * feed, a list with nothing loaded, or a re-read that fails, leaves the head
 * alone with "Load more" starting from it.
 */
export function reconcileOlderNotifications(
  qc: QueryClient,
  olderKey: QueryKey,
  head: NotificationFeedHead,
  fetchPage: FetchNotificationPage,
  limit: number,
): Promise<void> {
  return inTurn(qc, olderKey, async () => {
    const older = readOlder(qc, olderKey)
    if (!older) return
    const from = head.page.nextCursor
    const continues = sameFeedPosition(older.from, from)
    if (continues && older.staleWrites === 0 && !provesStale(head, older)) return
    if (!from || older.rows.length === 0) {
      qc.setQueryData(olderKey, null)
      return
    }
    const writesBefore = older.staleWrites
    try {
      const reread = await readDown(fetchPage, from, older.rows.length, limit)
      const current = readOlder(qc, olderKey) ?? older
      qc.setQueryData<OlderNotifications>(olderKey, {
        ...current,
        ...reread,
        from,
        loadMoreError: null,
        // A write marked meanwhile may postdate these reads: it stays marked.
        staleWrites: current.staleWrites - writesBefore,
      })
    } catch {
      qc.setQueryData(olderKey, null)
    }
  })
}

/** Every older list cached under `listsKey` (the Organization's), as `[key, list]`. */
function olderLists(qc: QueryClient, listsKey: QueryKey) {
  return qc
    .getQueriesData<unknown>({ queryKey: listsKey })
    .flatMap(([key, data]) => (isOlderList(data) ? [[key, data] as const] : []))
}

/** Marks every older list of the Organization for the next head read to re-read. */
export function markOlderNotificationsStale(qc: QueryClient, listsKey: QueryKey): void {
  for (const [key, older] of olderLists(qc, listsKey)) {
    qc.setQueryData<OlderNotifications>(key, {
      ...older,
      staleWrites: older.staleWrites + 1,
    })
  }
}

/**
 * Applies a write the server confirmed to every older list of the
 * Organization: the lists are never polled, so a confirmed change that only
 * the head would show again must be made to them directly. `patchFor` gives
 * the patch as one list sees it (its filter decides whether a changed row
 * stays in it).
 */
export function patchOlderNotifications(
  qc: QueryClient,
  listsKey: QueryKey,
  patchFor: (key: QueryKey) => (row: NotificationView) => NotificationView | null,
): void {
  for (const [key, older] of olderLists(qc, listsKey)) {
    const patch = patchFor(key)
    qc.setQueryData<OlderNotifications>(key, {
      ...older,
      rows: older.rows.flatMap((row) => {
        const patched = patch(row)
        return patched ? [patched] : []
      }),
    })
  }
}

/**
 * The head's rows, then every older row not already shown: the head wins for
 * an id both hold (it is the fresher read).
 */
export function mergeNotificationRows(
  head: NotificationPage | undefined,
  older: ReadonlyArray<NotificationView> = [],
): ReadonlyArray<NotificationView> {
  const seen = new Set<string>()
  return [...(head?.notifications ?? []), ...older].filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
}
