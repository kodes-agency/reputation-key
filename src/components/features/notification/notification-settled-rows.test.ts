// A settled row (its work closed upstream) keeps status 'unread' until opened,
// but the server stops counting it: it leaves the badge and the Unread tab
// (repository `stillWaiting`). The client's reading of "unread" must agree,
// or every poll judges loaded history stale, the bell lists "Done" rows under
// "New", and optimistic writes move the badge for rows it never counted.

import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  makeNotification,
  notificationPageFixture,
} from './notification.stories.fixtures'
import {
  fetchHeadKeepingHistoryContiguous,
  type NotificationHistoryPages,
} from './notification-feed-pagination'
import { groupByReadState, matchesNotificationFilter } from './notification-filters'
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
  it('does not make the head poll throw away loaded history', async () => {
    const qc = new QueryClient()
    const headKey = ['head']
    const historyKey = ['history']
    const headPage = notificationPageFixture([waiting, settled], true)
    const history: NotificationHistoryPages = {
      pages: [notificationPageFixture([older])],
      pageParams: [headPage.nextCursor],
    }
    qc.setQueryData(historyKey, history)

    const fetchHead = fetchHeadKeepingHistoryContiguous(
      qc,
      headKey,
      historyKey,
      async () => ({
        page: headPage,
        unreadCount: 1,
        filterUnreadCount: 1,
        watermark: 'w',
      }),
      async () => notificationPageFixture(),
    )
    await fetchHead()

    expect(qc.getQueryData(historyKey)).toEqual(history)
  })

  it('is not on the Unread tab', () => {
    expect(matchesNotificationFilter(settled, 'unread')).toBe(false)
    expect(matchesNotificationFilter(waiting, 'unread')).toBe(true)
  })

  it('lists under "Earlier", not "New"', () => {
    const groups = groupByReadState([waiting, settled])
    expect(
      groups.map((group) => [group.key, group.notifications.map((n) => n.id)]),
    ).toEqual([
      ['new', [waiting.id]],
      ['earlier', [settled.id]],
    ])
  })

  it('does not move the badge when opened or dismissed', () => {
    const open = (row: typeof settled) => ({ ...row, status: 'read' as const })
    expect(unreadDeltaWithin([settled], open, 'all')).toBe(0)
    expect(unreadDeltaWithin([settled], () => null, 'all')).toBe(0)
    expect(unreadDeltaWithin([waiting], () => null, 'all')).toBe(-1)
  })
})
