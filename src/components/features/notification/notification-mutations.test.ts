import { beforeEach, describe, expect, it } from 'vitest'
import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { createKeys } from '#/shared/queries/query-keys'
import type {
  NotificationFeedHead,
  NotificationListFilter,
  NotificationView,
} from '#/contexts/feed/application/public-api'
import {
  makeNotification,
  notificationFeedHeadFixture,
  notificationPageFixture,
} from './notification.stories.fixtures'
import { mergeNotificationRows, type OlderNotifications } from './notification-feed-older'
import {
  feedWriteKey,
  pendingFeedWrites,
  settleFeedWrite,
  withPendingWrites,
  type PendingFeedWrite,
} from './notification-feed-writes'

const scope = { userId: 'user-1', organizationId: 'org-1' }
const { notificationKeys } = createKeys(scope)

const olderOf = (rows: ReadonlyArray<NotificationView>): OlderNotifications => ({
  from: { at: '2026-09-01T12:00:00.000000Z', id: '10000000-0000-4000-8000-0000000000ff' },
  rows,
  nextCursor: null,
  isLoadingMore: false,
  loadMoreError: null,
  staleWrites: 0,
})

const markRead = (row: NotificationView): PendingFeedWrite => ({
  kind: 'markRead',
  input: { data: { notificationId: row.id } },
})
const markAllRead = (
  filter: NotificationListFilter,
  propertyId?: string,
): PendingFeedWrite => ({
  kind: 'markAllRead',
  input: { data: propertyId ? { filter, propertyId } : { filter } },
})

describe('notification writes in flight', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient()
  })

  /** One surface as useNotifications shows it, with `writes` in flight. */
  function shown(
    limit: number,
    filter: NotificationListFilter,
    writes: ReadonlyArray<PendingFeedWrite>,
    propertyId?: string,
  ) {
    const head = client.getQueryData<NotificationFeedHead>(
      notificationKeys.head('org-1', limit, filter, propertyId),
    )
    const older = client.getQueryData<OlderNotifications>(
      notificationKeys.list('org-1', limit, filter, propertyId),
    )
    return withPendingWrites(
      client,
      scope,
      'org-1',
      { filter, propertyId },
      {
        rows: mergeNotificationRows(head?.page, older?.rows),
        unreadCount: head?.unreadCount ?? 0,
        filterUnreadCount: head?.filterUnreadCount ?? 0,
        hasMore: head?.page.hasMore ?? false,
      },
      writes,
    )
  }
  const counts = (view: ReturnType<typeof shown>) => [
    view.unreadCount,
    view.filterUnreadCount,
  ]

  it('shows a row read in the head and the older rows while counting an overlapping row once', () => {
    const target = makeNotification({
      id: '10000000-0000-4000-8000-000000000020',
      status: 'unread',
    })
    const older = makeNotification({
      id: '10000000-0000-4000-8000-000000000021',
      status: 'read',
    })
    client.setQueryData(notificationKeys.head('org-1', 20, 'all'), {
      page: notificationPageFixture([target], true),
      unreadCount: 1,
      filterUnreadCount: 1,
      watermark: 'snapshot-before',
    })
    client.setQueryData(
      notificationKeys.list('org-1', 20, 'all'),
      olderOf([target, older]),
    )

    const during = shown(20, 'all', [markRead(target)])
    expect(counts(during)).toEqual([0, 0])
    expect(during.rows.map((row) => row.status)).toEqual(['read', 'read'])

    // Once it is no longer in flight, the server's reads show as they are.
    const after = shown(20, 'all', [])
    expect(counts(after)).toEqual([1, 1])
    expect(after.rows[0]?.status).toBe('unread')
  })

  it('shows an exact zero for a bulk read that reaches rows nobody loaded', () => {
    const cached = makeNotification({
      id: '10000000-0000-4000-8000-000000000030',
      status: 'unread',
    })
    client.setQueryData(notificationKeys.head('org-1', 20, 'all'), {
      page: notificationPageFixture([cached], true),
      // The page is intentionally smaller than the exact count.
      unreadCount: 9,
      filterUnreadCount: 9,
      watermark: 'snapshot-nine',
    })

    expect(counts(shown(20, 'all', [markAllRead('all')]))).toEqual([0, 0])
  })

  it('stops loading more while "Dismiss all" is in flight', () => {
    const row = makeNotification({ id: '10000000-0000-4000-8000-000000000031' })
    client.setQueryData(
      notificationKeys.head('org-1', 20, 'all'),
      notificationFeedHeadFixture([row], 7, true),
    )

    const view = shown(20, 'all', [{ kind: 'dismissAll', input: undefined }])
    expect(view.rows).toEqual([])
    expect(view.hasMore).toBe(false)
    expect(counts(view)).toEqual([0, 0])
  })

  it('applies writes in the order they were made', () => {
    const row = makeNotification({
      id: '10000000-0000-4000-8000-000000000032',
      status: 'unread',
    })
    client.setQueryData(
      notificationKeys.head('org-1', 20, 'all'),
      notificationFeedHeadFixture([row], 1, false),
    )

    const markedUnreadAgain = shown(20, 'all', [
      markRead(row),
      { kind: 'markUnread', input: { data: { notificationId: row.id } } },
    ])
    expect(markedUnreadAgain.rows[0]?.status).toBe('unread')
    expect(counts(markedUnreadAgain)).toEqual([1, 1])
  })

  it('moves every surface that holds the row, not only the one that acted', () => {
    const [onScreen, loadedLater] = [
      makeNotification({ id: '10000000-0000-4000-8000-000000000050', status: 'unread' }),
      makeNotification({ id: '10000000-0000-4000-8000-000000000051', status: 'unread' }),
    ]
    // The bell (20 per page) loaded the row through "Load more"; the page (50
    // per page, Unread tab) holds it in its own older rows.
    client.setQueryData(
      notificationKeys.head('org-1', 20, 'all'),
      notificationFeedHeadFixture([onScreen], 2, true),
    )
    client.setQueryData(notificationKeys.list('org-1', 20, 'all'), olderOf([loadedLater]))
    client.setQueryData(
      notificationKeys.head('org-1', 50, 'unread'),
      notificationFeedHeadFixture([onScreen], 2, true),
    )
    client.setQueryData(
      notificationKeys.list('org-1', 50, 'unread'),
      olderOf([loadedLater]),
    )

    const writes = [markRead(loadedLater)]
    const bell = shown(20, 'all', writes)
    const page = shown(50, 'unread', writes)
    expect(bell.rows.map((row) => row.status)).toEqual(['unread', 'read'])
    // A read row no longer belongs under the Unread filter.
    expect(page.rows.map((row) => row.id)).toEqual([onScreen.id])
    // The unread count is the Organization's, so every head drops by one.
    expect(bell.unreadCount).toBe(1)
    expect(page.unreadCount).toBe(1)
  })

  it("marks read only the acting tab's rows, and moves every count by that tab's exact share", () => {
    const urgent = makeNotification({
      id: '10000000-0000-4000-8000-000000000060',
      type: 'inbox.escalated',
      priority: 'urgent',
    })
    const workflow = makeNotification({
      id: '10000000-0000-4000-8000-000000000061',
      type: 'inbox_note.added',
    })
    // Five unread in all; the Workflow tab holds two, only one of them loaded.
    client.setQueryData(notificationKeys.head('org-1', 20, 'all'), {
      ...notificationFeedHeadFixture([urgent, workflow], 5, true),
      filterUnreadCount: 5,
    })
    client.setQueryData(notificationKeys.head('org-1', 50, 'workflow_collaboration'), {
      ...notificationFeedHeadFixture([workflow], 5, true),
      filterUnreadCount: 2,
    })

    const writes = [markAllRead('workflow_collaboration')]
    const bell = shown(20, 'all', writes)
    const page = shown(50, 'workflow_collaboration', writes)
    expect(bell.rows.map((row) => row.status)).toEqual(['unread', 'read'])
    expect(counts(bell)).toEqual([3, 3])
    expect(counts(page)).toEqual([3, 0])
  })

  // The page's Property filter: a filtered head holds one Property's share.
  describe('a head filtered to one Property', () => {
    const HARBOUR = '10000000-0000-4000-8000-0000000000a1'
    const RIVERSIDE = '10000000-0000-4000-8000-0000000000a2'
    const harbour = makeNotification({
      id: '10000000-0000-4000-8000-000000000070',
      type: 'inbox.escalated',
      propertyId: HARBOUR,
    })
    const riverside = makeNotification({
      id: '10000000-0000-4000-8000-000000000071',
      type: 'inbox.escalated',
      propertyId: RIVERSIDE,
    })

    beforeEach(() => {
      // The bell: four waiting across Properties, two loaded. The page,
      // filtered to Harbour: its one.
      client.setQueryData(notificationKeys.head('org-1', 20, 'needs_you'), {
        ...notificationFeedHeadFixture([harbour, riverside], 4, true),
        filterUnreadCount: 4,
      })
      client.setQueryData(notificationKeys.head('org-1', 50, 'all', HARBOUR), {
        ...notificationFeedHeadFixture([harbour], 1, false),
        filterUnreadCount: 1,
      })
    })
    const bell = (writes: ReadonlyArray<PendingFeedWrite>) =>
      shown(20, 'needs_you', writes)
    const page = (writes: ReadonlyArray<PendingFeedWrite>) =>
      shown(50, 'all', writes, HARBOUR)

    it('a Property-scoped "Mark all read" moves the bell by the loaded rows, never to zero', () => {
      const writes = [markAllRead('all', HARBOUR)]

      // Read now, Harbour's row leaves Needs you; Riverside's stays.
      expect(bell(writes).rows.map((row) => row.id)).toEqual([riverside.id])
      expect(counts(bell(writes))).toEqual([3, 3])
      expect(counts(page(writes))).toEqual([0, 0])
    })

    it("does not move for another Property's row", () => {
      expect(counts(page([markRead(riverside)]))).toEqual([1, 1])
    })

    it('an unscoped tab\'s "Mark all read" moves a filtered head by its own rows, not the tab\'s count', () => {
      // Harbour also holds an unread note, which Needs you does not.
      const note = makeNotification({
        id: '10000000-0000-4000-8000-000000000072',
        type: 'inbox_note.added',
        propertyId: HARBOUR,
      })
      client.setQueryData(notificationKeys.head('org-1', 50, 'all', HARBOUR), {
        ...notificationFeedHeadFixture([harbour, note], 2, false),
        filterUnreadCount: 2,
      })

      // "Mark all read" on the page's Needs you tab, unfiltered: the bell's
      // head says four rows went, but only one of them was Harbour's.
      expect(counts(page([markAllRead('needs_you')]))).toEqual([1, 1])
    })

    it('an unscoped tab\'s "Mark all read" takes a filtered head\'s count only when every unread row went', () => {
      expect(counts(page([markAllRead('all')]))).toEqual([0, 0])
    })
  })

  it("moves another tab's share by the loaded rows a row action changes", () => {
    const urgentWorkflow = makeNotification({
      id: '10000000-0000-4000-8000-000000000070',
      type: 'inbox_note.added',
      priority: 'urgent',
    })
    client.setQueryData(notificationKeys.head('org-1', 20, 'urgent'), {
      ...notificationFeedHeadFixture([urgentWorkflow], 4, true),
      filterUnreadCount: 2,
    })
    client.setQueryData(notificationKeys.head('org-1', 50, 'workflow_collaboration'), {
      ...notificationFeedHeadFixture([urgentWorkflow], 4, true),
      filterUnreadCount: 3,
    })

    const writes = [markRead(urgentWorkflow)]
    expect(shown(20, 'urgent', writes).filterUnreadCount).toBe(1)
    expect(shown(50, 'workflow_collaboration', writes).filterUnreadCount).toBe(2)
  })

  it("shows and settles only the signed-in person's writes in this Organization", async () => {
    const row = makeNotification({ id: '10000000-0000-4000-8000-000000000080' })
    const elsewhere = createKeys({ userId: 'user-1', organizationId: 'org-2' })
    const someoneElse = createKeys({ userId: 'user-2', organizationId: 'org-1' })
    for (const keys of [notificationKeys, elsewhere.notificationKeys]) {
      client.setQueryData(keys.list('org-1', 20, 'all'), olderOf([row]))
    }
    client.setQueryData(
      someoneElse.notificationKeys.list('org-1', 20, 'all'),
      olderOf([row]),
    )
    const pending = (organizationId: string, userId = 'user-1') =>
      new MutationObserver<void, Error, unknown>(client, {
        mutationKey: feedWriteKey({ userId, organizationId }, organizationId, 'dismiss'),
        mutationFn: () => new Promise<void>(() => {}),
      }).mutate({ data: { notificationId: row.id } })
    void pending('org-2')
    void pending('org-1', 'user-2')
    expect(pendingFeedWrites(client, scope, 'org-1')).toEqual([])
    void pending('org-1')
    expect(pendingFeedWrites(client, scope, 'org-1')).toEqual([
      { kind: 'dismiss', input: { data: { notificationId: row.id } } },
    ])

    await settleFeedWrite(
      client,
      scope,
      'org-1',
      { kind: 'dismiss', input: { data: { notificationId: row.id } } },
      true,
    )
    const olderRows = (key: readonly unknown[]) =>
      client.getQueryData<OlderNotifications>(key)?.rows.map((current) => current.id)
    expect(olderRows(notificationKeys.list('org-1', 20, 'all'))).toEqual([])
    expect(olderRows(elsewhere.notificationKeys.list('org-1', 20, 'all'))).toEqual([
      row.id,
    ])
    expect(olderRows(someoneElse.notificationKeys.list('org-1', 20, 'all'))).toEqual([
      row.id,
    ])
  })
})
