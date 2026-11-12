// Test-only harness: an in-memory notification feed that changes between
// requests, observed through the REAL query and mutation wiring
// useNotifications and useNotificationMutations build.
// The `.stories.` segment keeps this module out of production-shaped source
// inventories and bundles, like notification.stories.fixtures.ts.
//
// No React: the unit project is node-only, so the observers are driven
// directly, exactly as the hook configures them.

import {
  MutationObserver,
  QueryObserver,
  skipToken,
  type QueryClient,
} from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import type { NotificationFeedCursor } from '#/contexts/feed/application/public-api'
import {
  makeNotification,
  notificationPageFixture,
} from './notification.stories.fixtures'
import {
  notificationHeadQueryOptions,
  readHeadKeepingOlderTrue,
} from './notification-feed-head'
import {
  loadOlderNotifications,
  mergeNotificationRows,
  type OlderNotifications,
} from './notification-feed-older'
import {
  feedWriteOptions,
  pendingFeedWrites,
  withPendingWrites,
  type FeedWriteKind,
} from './notification-feed-writes'

const SCOPE = { userId: 'user-1', organizationId: 'org-1' }
const { notificationKeys } = createKeys(SCOPE)

export const LIVE_FEED_LIMIT = 20
const FEED_START = Date.parse('2026-09-01T12:00:00.000Z')

const feedRowId = (series: 1 | 2, n: number) =>
  `${series}0000000-0000-4000-8000-${n.toString().padStart(12, '0')}`

/** An in-memory feed, newest first, that the scenario can change between requests. */
export function createLiveFeed(size: number) {
  const labels = new Map<string, string>()
  const requests: string[] = []
  const row = (series: 1 | 2, n: number, label: string, at: number) => {
    const id = feedRowId(series, n)
    labels.set(id, label)
    return makeNotification({ id, createdAt: new Date(at) })
  }
  let rows = Array.from({ length: size }, (_, n) =>
    row(1, n, `R${n}`, FEED_START - n * 60_000),
  )
  let arrivals = 0
  // While held, a request is answered with the feed as it was when the
  // request was made, and only once released: a read in flight.
  let heldHeads: Array<() => void> | null = null
  let heldPages: Array<() => void> | null = null
  let pagesFail = false
  const removed = new Map<string, (typeof rows)[number]>()

  const label = (id: string) => labels.get(id) ?? id
  const pageOf = (candidates: typeof rows, limit = LIVE_FEED_LIMIT) =>
    notificationPageFixture(candidates.slice(0, limit), candidates.length > limit)
  // Served like the endpoint: rows strictly after the cursor in feed order,
  // which is latest activity (a coalesced row's newest event) first.
  const activityAt = (current: (typeof rows)[number]) =>
    (current.coalescedLatestAt ?? current.createdAt).getTime()
  const after = (cursor: NotificationFeedCursor) => {
    const at = Date.parse(cursor.at.replace(/(\.\d{3})\d{3}Z$/, '$1Z'))
    return rows.filter(
      (current) =>
        activityAt(current) < at ||
        (activityAt(current) === at && current.id < cursor.id),
    )
  }

  return {
    requests,
    label,
    labels: () => rows.map((current) => label(current.id)),
    labelsById: () => labels.entries(),
    removedId: (gone: string) => removed.get(gone)?.id ?? gone,
    arrive: (count: number) => {
      for (let k = 0; k < count; k += 1) {
        arrivals += 1
        const arrival = row(2, arrivals, `N${arrivals}`, FEED_START + arrivals * 60_000)
        rows = [arrival, ...rows]
      }
    },
    remove: (gone: string) => {
      for (const current of rows) {
        if (label(current.id) === gone) removed.set(gone, current)
      }
      rows = rows.filter((current) => label(current.id) !== gone)
    },
    // An Undo: the row comes back at its own place in feed order.
    restore: (back: string) => {
      const row = removed.get(back)
      if (!row) throw new Error(`no removed row ${back}`)
      removed.delete(back)
      rows = [...rows, row].sort((a, b) =>
        activityAt(a) === activityAt(b)
          ? b.id.localeCompare(a.id)
          : activityAt(b) - activityAt(a),
      )
    },
    markRead: (read: string) => {
      rows = rows.map((current) =>
        label(current.id) === read ? { ...current, status: 'read' as const } : current,
      )
    },
    // A repeat event absorbed by an existing row: it re-sorts to the top.
    coalesce: (repeated: string) => {
      arrivals += 1
      const bumped = rows.find((current) => label(current.id) === repeated)
      if (!bumped) throw new Error(`no row ${repeated} in the live feed`)
      rows = [
        {
          ...bumped,
          coalescedCount: bumped.coalescedCount + 1,
          coalescedLatestAt: new Date(FEED_START + arrivals * 60_000),
        },
        ...rows.filter((current) => current !== bumped),
      ]
    },
    // What another tab, or the other surface in this one, does to the feed.
    markAllRead: () => {
      rows = rows.map((current) => ({ ...current, status: 'read' as const }))
    },
    dismissAll: () => {
      rows = []
    },
    failPages: () => {
      pagesFail = true
    },
    holdHeads: () => {
      heldHeads = []
    },
    releaseHeads: () => {
      const waiting = heldHeads ?? []
      heldHeads = null
      for (const answer of waiting) answer()
    },
    holdPages: () => {
      heldPages = []
    },
    releasePages: () => {
      const waiting = heldPages ?? []
      heldPages = null
      for (const answer of waiting) answer()
    },
    head: async () => {
      requests.push('head')
      const unreadCount = rows.filter((current) => current.status === 'unread').length
      // The All tab's head: its filter's share is every unread row.
      const answer = {
        page: pageOf(rows),
        unreadCount,
        filterUnreadCount: unreadCount,
        watermark: 'live-feed',
      }
      const waiting = heldHeads
      if (waiting) await new Promise<void>((resolve) => waiting.push(resolve))
      return answer
    },
    pageAfter: async (before: NotificationFeedCursor, limit = LIVE_FEED_LIMIT) => {
      requests.push(`after ${label(before.id)}`)
      if (pagesFail) throw new Error('page read failed')
      const answer = pageOf(after(before), limit)
      const waiting = heldPages
      if (waiting) await new Promise<void>((resolve) => waiting.push(resolve))
      return answer
    },
  }
}

/** The observers useNotifications builds, and its view of them, without React. */
export function observeLiveFeed(
  client: QueryClient,
  feed: ReturnType<typeof createLiveFeed>,
) {
  const olderKey = notificationKeys.list('org-1', LIVE_FEED_LIMIT, 'all')
  const headKey = notificationKeys.head('org-1', LIVE_FEED_LIMIT, 'all')
  const headObserver = new QueryObserver(
    client,
    notificationHeadQueryOptions(
      headKey,
      readHeadKeepingOlderTrue(
        client,
        olderKey,
        feed.head,
        feed.pageAfter,
        LIVE_FEED_LIMIT,
      ),
      true,
    ),
  )
  const olderObserver = new QueryObserver<OlderNotifications | null>(client, {
    queryKey: olderKey,
    queryFn: skipToken,
    staleTime: Infinity,
  })
  const unsubscribeHead = headObserver.subscribe(() => {})
  const unsubscribeOlder = olderObserver.subscribe(() => {})
  const shown = () => {
    const head = headObserver.getCurrentResult().data
    const older = olderObserver.getCurrentResult().data ?? null
    return withPendingWrites(
      client,
      SCOPE,
      'org-1',
      { filter: 'all' },
      {
        rows: mergeNotificationRows(head?.page, older?.rows),
        unreadCount: head?.unreadCount ?? 0,
        filterUnreadCount: head?.filterUnreadCount ?? 0,
        hasMore: older ? older.nextCursor !== null : (head?.page.hasMore ?? false),
      },
      pendingFeedWrites(client, SCOPE, 'org-1'),
    )
  }

  return {
    loadMore: () =>
      loadOlderNotifications(client, olderKey, headKey, feed.pageAfter, LIVE_FEED_LIMIT),
    visible: () => shown().rows.map((row) => feed.label(row.id)),
    unreadVisible: () =>
      shown()
        .rows.filter((row) => row.status === 'unread')
        .map((row) => feed.label(row.id)),
    unreadCount: () => shown().unreadCount,
    olderRowCount: () => olderObserver.getCurrentResult().data?.rows.length ?? 0,
    headError: () => headObserver.getCurrentResult().error,
    /**
     * A feed write through the hook's own mutation wiring. `apply` is what the
     * server does; the write answers when `answer` is called.
     */
    write: (kind: FeedWriteKind, input: unknown, apply: () => void) => {
      let answer: (ok: boolean) => void = () => {}
      const observer = new MutationObserver(client, {
        ...feedWriteOptions(client, SCOPE, 'org-1', kind),
        mutationFn: () =>
          new Promise<void>((resolve, reject) => {
            answer = (ok) => {
              if (!ok) return reject(new Error('write failed'))
              apply()
              resolve()
            }
          }),
      })
      const settled = observer.mutate(input).catch(() => undefined)
      return { answer: (ok: boolean) => answer(ok), settled }
    },
    stop: () => {
      unsubscribeHead()
      unsubscribeOlder()
    },
  }
}
