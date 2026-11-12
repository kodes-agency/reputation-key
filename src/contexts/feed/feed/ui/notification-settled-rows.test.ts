// A settled row (its work closed upstream) keeps status 'unread' until opened,
// but the server stops counting it: it leaves the badge and the Unread tab
// (repository `stillWaiting`). The client's reading of "unread" must agree,
// or every poll judges loaded older rows stale, the bell lists "Done" rows under
// "New", and optimistic writes move the badge for rows it never counted.

import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  makeNotification,
  notificationPageFixture,
} from './notification.stories.fixtures'
import { readHeadKeepingOlderTrue } from './notification-feed-head'
import type { OlderNotifications } from './notification-feed-older'
import { matchesNotificationFilter } from './notification-filters'
import { unreadDeltaWithin } from './notification-feed-counts'

const settled = makeNotification({
  id: '20000000-0000-4000-8000-000000000001',
  resolvedAt: new Date(Date.now() - 60_000),
})
const waiting = makeNotification({ id: '20000000-0000-4000-8000-000000000002' })
const older = makeNotification({
  id: '20000000-0000-4000-8000-000000000003',
  status: 'read',
  createdAt: new Date(Date.now() - 86_400_000),
})

describe('a settled-but-unread row', () => {
  it('does not make the head poll re-read the loaded older rows', async () => {
    const qc = new QueryClient()
    const olderKey = ['older']
    const headPage = notificationPageFixture([waiting, settled], true)
    const loaded: OlderNotifications = {
      from: headPage.nextCursor!,
      rows: [older],
      nextCursor: null,
      isLoadingMore: false,
      loadMoreError: null,
      staleWrites: 0,
    }
    qc.setQueryData(olderKey, loaded)
    const pageReads: unknown[] = []

    const fetchHead = readHeadKeepingOlderTrue(
      qc,
      olderKey,
      async () => ({
        page: headPage,
        unreadCount: 1,
        filterUnreadCount: 1,
        watermark: 'w',
      }),
      async (before) => {
        pageReads.push(before)
        return notificationPageFixture()
      },
      20,
    )
    await fetchHead()

    expect(pageReads).toEqual([])
    expect(qc.getQueryData(olderKey)).toEqual(loaded)
  })

  it('is not on the Unread tab', () => {
    expect(matchesNotificationFilter(settled, 'unread')).toBe(false)
    expect(matchesNotificationFilter(waiting, 'unread')).toBe(true)
  })

  it('is an update, not something that needs its reader', () => {
    const approval = { ...settled, type: 'reply.pending_approval' as const }
    expect(matchesNotificationFilter(approval, 'needs_you')).toBe(false)
    expect(matchesNotificationFilter(approval, 'updates')).toBe(true)
    expect(
      matchesNotificationFilter(
        { ...waiting, type: 'reply.pending_approval' },
        'needs_you',
      ),
    ).toBe(true)
  })

  it('does not move the badge when opened or dismissed', () => {
    const open = (row: typeof settled) => ({ ...row, status: 'read' as const })
    expect(unreadDeltaWithin([settled], open, 'all')).toBe(0)
    expect(unreadDeltaWithin([settled], () => null, 'all')).toBe(0)
    expect(unreadDeltaWithin([waiting], () => null, 'all')).toBe(-1)
  })
})
