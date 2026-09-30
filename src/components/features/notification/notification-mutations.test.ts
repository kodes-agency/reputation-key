import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { notificationKeys } from '#/shared/queries/query-keys'
import type { NotificationFeedHead } from '#/contexts/feed/application/public-api'
import {
  makeNotification,
  notificationFeedHeadFixture,
  notificationPageFixture,
} from './notification.stories.fixtures'
import { patchNotificationFeedCache } from './notification-feed-cache'

/** Lets settled promises and zero-delay timers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('notification optimistic cache updates', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient()
  })

  it('patches the head and loaded history while counting an overlapping row once', () => {
    const listKey = notificationKeys.list('org-1', 20, 'all')
    const headKey = notificationKeys.head('org-1', 20, 'all')
    const target = makeNotification({
      id: '10000000-0000-4000-8000-000000000020',
      status: 'unread',
    })
    const older = makeNotification({
      id: '10000000-0000-4000-8000-000000000021',
      status: 'read',
    })

    client.setQueryData(headKey, {
      page: notificationPageFixture([target], true),
      unreadCount: 1,
      filterUnreadCount: 1,
      watermark: 'snapshot-before',
    })
    client.setQueryData(listKey, {
      pages: [notificationPageFixture([target, older])],
      pageParams: [20],
    })
    const undo = patchNotificationFeedCache(client, 'org-1', (row) =>
      row.id === target.id
        ? { ...row, status: 'read' as const, readAt: new Date(0) }
        : row,
    )

    expect(client.getQueryData<{ unreadCount: number }>(headKey)?.unreadCount).toBe(0)
    expect(
      client.getQueryData<{
        page: ReturnType<typeof notificationPageFixture>
      }>(headKey)?.page.notifications[0]?.status,
    ).toBe('read')
    expect(
      client.getQueryData<{
        pages: ReadonlyArray<ReturnType<typeof notificationPageFixture>>
      }>(listKey)?.pages[0]?.notifications[0]?.status,
    ).toBe('read')

    undo?.()

    expect(client.getQueryData<{ unreadCount: number }>(headKey)?.unreadCount).toBe(1)
    expect(
      client.getQueryData<{
        page: ReturnType<typeof notificationPageFixture>
      }>(headKey)?.page.notifications[0]?.status,
    ).toBe('unread')
    expect(client.getQueryData<{ watermark: string }>(headKey)?.watermark).toBe(
      'snapshot-before',
    )
  })

  it('sets an exact zero for bulk read and restores the whole snapshot on failure', () => {
    const headKey = notificationKeys.head('org-1', 20, 'all')
    const cached = makeNotification({
      id: '10000000-0000-4000-8000-000000000030',
      status: 'unread',
    })
    const snapshot = {
      page: notificationPageFixture([cached], true),
      // The page is intentionally smaller than the exact count.
      unreadCount: 9,
      filterUnreadCount: 9,
      watermark: 'snapshot-nine',
    }
    client.setQueryData(headKey, snapshot)

    const undo = patchNotificationFeedCache(
      client,
      'org-1',
      (row) => ({ ...row, status: 'read' as const, readAt: new Date(0) }),
      { clearsUnreadOf: 'all' },
    )

    expect(client.getQueryData<{ unreadCount: number }>(headKey)?.unreadCount).toBe(0)
    undo?.()
    expect(client.getQueryData(headKey)).toEqual(snapshot)
  })

  it('cancels an in-flight head read so its older answer cannot overwrite the write', async () => {
    const headKey = notificationKeys.head('org-1', 20, 'all')
    const row = makeNotification({
      id: '10000000-0000-4000-8000-000000000040',
      status: 'unread',
    })
    // Opening the bell starts this read; the click lands before it answers,
    // and the answer describes the feed from before the click.
    const beforeTheWrite = notificationFeedHeadFixture([row], 1)
    const answers: Array<PromiseWithResolvers<NotificationFeedHead>> = []
    client.setQueryData(headKey, beforeTheWrite)
    const observer = new QueryObserver(client, {
      queryKey: headKey,
      queryFn: () => {
        const answer = Promise.withResolvers<NotificationFeedHead>()
        answers.push(answer)
        return answer.promise
      },
    })
    // Subscribing to a stale head starts the read.
    const unsubscribe = observer.subscribe(() => {})
    expect(answers).toHaveLength(1)

    patchNotificationFeedCache(client, 'org-1', (current) =>
      current.id === row.id
        ? { ...current, status: 'read' as const, readAt: new Date(0) }
        : current,
    )
    answers[0]?.resolve(beforeTheWrite)
    await settle()

    const head = client.getQueryData<NotificationFeedHead>(headKey)
    expect(head?.unreadCount).toBe(0)
    expect(head?.page.notifications[0]?.status).toBe('read')
    unsubscribe()
  })

  it('patches every surface that holds the row, not only the one that acted', () => {
    const [shown, loadedLater] = [
      makeNotification({ id: '10000000-0000-4000-8000-000000000050', status: 'unread' }),
      makeNotification({ id: '10000000-0000-4000-8000-000000000051', status: 'unread' }),
    ]
    const bellHead = notificationKeys.head('org-1', 20, 'all')
    const bellHistory = notificationKeys.list('org-1', 20, 'all')
    const pageHead = notificationKeys.head('org-1', 50, 'unread')
    const pageHistory = notificationKeys.list('org-1', 50, 'unread')
    // The bell (20 per page) loaded the row through "Load more"; the page (50
    // per page, Unread tab) holds it in its own history.
    client.setQueryData(bellHead, notificationFeedHeadFixture([shown], 2, true))
    client.setQueryData(bellHistory, {
      pages: [notificationPageFixture([loadedLater])],
      pageParams: [null],
    })
    client.setQueryData(pageHead, notificationFeedHeadFixture([shown], 2, true))
    client.setQueryData(pageHistory, {
      pages: [notificationPageFixture([loadedLater])],
      pageParams: [null],
    })

    // Marked read from the page's head.
    patchNotificationFeedCache(client, 'org-1', (row) =>
      row.id === loadedLater.id
        ? { ...row, status: 'read' as const, readAt: new Date(0) }
        : row,
    )

    type History = { pages: ReadonlyArray<ReturnType<typeof notificationPageFixture>> }
    const rows = (key: readonly unknown[]) =>
      client.getQueryData<History>(key)?.pages.flatMap((page) => page.notifications)
    expect(rows(bellHistory)?.map((row) => row.status)).toEqual(['read'])
    // A read row no longer belongs under the Unread filter.
    expect(rows(pageHistory)).toEqual([])
    // The unread count is the Organization's, so every head drops by one.
    expect(client.getQueryData<NotificationFeedHead>(bellHead)?.unreadCount).toBe(1)
    expect(client.getQueryData<NotificationFeedHead>(pageHead)?.unreadCount).toBe(1)
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
    const bellHead = notificationKeys.head('org-1', 20, 'all')
    const pageHead = notificationKeys.head('org-1', 50, 'workflow_collaboration')
    // Five unread in all; the Workflow tab holds two, only one of them loaded.
    client.setQueryData(bellHead, {
      ...notificationFeedHeadFixture([urgent, workflow], 5, true),
      filterUnreadCount: 5,
    })
    client.setQueryData(pageHead, {
      ...notificationFeedHeadFixture([workflow], 5, true),
      filterUnreadCount: 2,
    })

    // "Mark all read" on the page's Workflow tab.
    patchNotificationFeedCache(
      client,
      'org-1',
      (row) =>
        row.status === 'unread' && row.category === 'workflow_collaboration'
          ? { ...row, status: 'read' as const, readAt: new Date(0) }
          : row,
      { clearsUnreadOf: 'workflow_collaboration' },
    )

    const bell = client.getQueryData<NotificationFeedHead>(bellHead)
    const page = client.getQueryData<NotificationFeedHead>(pageHead)
    expect(bell?.page.notifications.map((row) => row.status)).toEqual(['unread', 'read'])
    expect([bell?.unreadCount, bell?.filterUnreadCount]).toEqual([3, 3])
    expect([page?.unreadCount, page?.filterUnreadCount]).toEqual([3, 0])
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
    const readNow = (row: typeof harbour) => ({
      ...row,
      status: 'read' as const,
      readAt: new Date(0),
    })
    const bellHead = notificationKeys.head('org-1', 20, 'needs_you')
    const pageHead = notificationKeys.head('org-1', 50, 'all', HARBOUR)

    beforeEach(() => {
      // The bell: four waiting across Properties, two loaded. The page,
      // filtered to Harbour: its one.
      client.setQueryData(bellHead, {
        ...notificationFeedHeadFixture([harbour, riverside], 4, true),
        filterUnreadCount: 4,
      })
      client.setQueryData(pageHead, {
        ...notificationFeedHeadFixture([harbour], 1, false),
        filterUnreadCount: 1,
      })
    })

    it('a Property-scoped "Mark all read" moves the bell by the loaded rows, never to zero', () => {
      patchNotificationFeedCache(client, 'org-1', (row) =>
        row.propertyId === HARBOUR && row.status === 'unread' ? readNow(row) : row,
      )

      const bell = client.getQueryData<NotificationFeedHead>(bellHead)
      const page = client.getQueryData<NotificationFeedHead>(pageHead)
      // Read now, Harbour's row leaves Needs you; Riverside's stays.
      expect(bell?.page.notifications.map((row) => row.id)).toEqual([riverside.id])
      expect([bell?.unreadCount, bell?.filterUnreadCount]).toEqual([3, 3])
      expect([page?.unreadCount, page?.filterUnreadCount]).toEqual([0, 0])
    })

    it("does not move for another Property's row", () => {
      patchNotificationFeedCache(client, 'org-1', (row) =>
        row.id === riverside.id ? readNow(row) : row,
      )

      const page = client.getQueryData<NotificationFeedHead>(pageHead)
      expect([page?.unreadCount, page?.filterUnreadCount]).toEqual([1, 1])
    })

    it('an unscoped tab\'s "Mark all read" moves a filtered head by its own rows, not the tab\'s count', () => {
      // Harbour also holds an unread note, which Needs you does not.
      const note = makeNotification({
        id: '10000000-0000-4000-8000-000000000072',
        type: 'inbox_note.added',
        propertyId: HARBOUR,
      })
      client.setQueryData(pageHead, {
        ...notificationFeedHeadFixture([harbour, note], 2, false),
        filterUnreadCount: 2,
      })

      // "Mark all read" on the page's Needs you tab, unfiltered: the bell's
      // head says four rows went, but only one of them was Harbour's.
      patchNotificationFeedCache(
        client,
        'org-1',
        (row) =>
          row.type === 'inbox.escalated' && row.status === 'unread' ? readNow(row) : row,
        { clearsUnreadOf: 'needs_you' },
      )

      const page = client.getQueryData<NotificationFeedHead>(pageHead)
      expect([page?.unreadCount, page?.filterUnreadCount]).toEqual([1, 1])
    })

    it('an unscoped tab\'s "Mark all read" takes a filtered head\'s count only when every unread row went', () => {
      patchNotificationFeedCache(
        client,
        'org-1',
        (row) => (row.status === 'unread' ? readNow(row) : row),
        { clearsUnreadOf: 'all' },
      )

      const page = client.getQueryData<NotificationFeedHead>(pageHead)
      expect([page?.unreadCount, page?.filterUnreadCount]).toEqual([0, 0])
    })
  })

  it("moves another tab's share by the loaded rows a row action changes", () => {
    const urgentWorkflow = makeNotification({
      id: '10000000-0000-4000-8000-000000000070',
      type: 'inbox_note.added',
      priority: 'urgent',
    })
    const urgentHead = notificationKeys.head('org-1', 20, 'urgent')
    const workflowHead = notificationKeys.head('org-1', 50, 'workflow_collaboration')
    client.setQueryData(urgentHead, {
      ...notificationFeedHeadFixture([urgentWorkflow], 4, true),
      filterUnreadCount: 2,
    })
    client.setQueryData(workflowHead, {
      ...notificationFeedHeadFixture([urgentWorkflow], 4, true),
      filterUnreadCount: 3,
    })

    patchNotificationFeedCache(client, 'org-1', (row) =>
      row.id === urgentWorkflow.id ? { ...row, status: 'read' as const } : row,
    )

    expect(client.getQueryData<NotificationFeedHead>(urgentHead)?.filterUnreadCount).toBe(
      1,
    )
    expect(
      client.getQueryData<NotificationFeedHead>(workflowHead)?.filterUnreadCount,
    ).toBe(2)
  })
})
