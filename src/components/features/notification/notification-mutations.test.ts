import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { notificationKeys } from '#/shared/queries/query-keys'
import {
  makeNotification,
  notificationPageFixture,
} from './notification.stories.fixtures'
import { patchNotificationFeedCache } from './notification-feed-cache'

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
})
