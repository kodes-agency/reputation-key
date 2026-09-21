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
    const undo = patchNotificationFeedCache(client, listKey, headKey, (row) =>
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
    const listKey = notificationKeys.list('org-1', 20, 'all')
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
      listKey,
      headKey,
      (row) => ({ ...row, status: 'read' as const, readAt: new Date(0) }),
      { unreadCount: 0 },
    )

    expect(client.getQueryData<{ unreadCount: number }>(headKey)?.unreadCount).toBe(0)
    undo?.()
    expect(client.getQueryData(headKey)).toEqual(snapshot)
  })

  it('cancels an in-flight head read so its older answer cannot overwrite the write', async () => {
    const listKey = notificationKeys.list('org-1', 20, 'all')
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

    patchNotificationFeedCache(client, listKey, headKey, (current) =>
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
})
