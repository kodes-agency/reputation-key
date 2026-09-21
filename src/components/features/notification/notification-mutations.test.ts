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
      watermark: 'snapshot-nine',
    }
    client.setQueryData(headKey, snapshot)

    const undo = patchNotificationFeedCache(
      client,
      'org-1',
      (row) => ({ ...row, status: 'read' as const, readAt: new Date(0) }),
      { unreadCount: 0 },
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
})
