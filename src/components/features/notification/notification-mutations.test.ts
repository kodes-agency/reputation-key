import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { notificationKeys } from '#/shared/queries/query-keys'
import { makeNotification, notificationPageFixture } from './notification-fixtures'
import { patchNotificationFeedCache } from './notification-feed-cache'

describe('notification optimistic cache updates', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient()
  })

  it('patches the head and loaded history while counting an overlapping row once', () => {
    const listKey = notificationKeys.list('org-1', 20, 'all')
    const headKey = notificationKeys.head('org-1', 20, 'all')
    const countKey = notificationKeys.count('org-1')
    const target = makeNotification({
      id: '10000000-0000-4000-8000-000000000020',
      status: 'unread',
    })
    const older = makeNotification({
      id: '10000000-0000-4000-8000-000000000021',
      status: 'read',
    })

    client.setQueryData(headKey, notificationPageFixture([target], true))
    client.setQueryData(listKey, {
      pages: [notificationPageFixture([target, older])],
      pageParams: [20],
    })
    client.setQueryData(countKey, { count: 1 })

    const undo = patchNotificationFeedCache(client, listKey, headKey, countKey, (row) =>
      row.id === target.id
        ? { ...row, status: 'read' as const, readAt: new Date(0) }
        : row,
    )

    expect(client.getQueryData<{ count: number }>(countKey)).toEqual({ count: 0 })
    expect(
      client.getQueryData<ReturnType<typeof notificationPageFixture>>(headKey)
        ?.notifications[0]?.status,
    ).toBe('read')
    expect(
      client.getQueryData<{
        pages: ReadonlyArray<ReturnType<typeof notificationPageFixture>>
      }>(listKey)?.pages[0]?.notifications[0]?.status,
    ).toBe('read')

    undo?.()

    expect(client.getQueryData<{ count: number }>(countKey)).toEqual({ count: 1 })
    expect(
      client.getQueryData<ReturnType<typeof notificationPageFixture>>(headKey)
        ?.notifications[0]?.status,
    ).toBe('unread')
  })
})
