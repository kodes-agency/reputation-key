import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getNotificationFeedHeadDto } from './notifications'

describe('notification feed-head server contract', () => {
  it('accepts only an offset-zero head request and applies bounded defaults', () => {
    expect(getNotificationFeedHeadDto.parse({})).toEqual({
      limit: 20,
      filter: 'all',
    })
    expect(
      getNotificationFeedHeadDto.safeParse({ limit: 101, filter: 'all' }).success,
    ).toBe(false)
    expect(
      getNotificationFeedHeadDto.safeParse({ limit: 20, filter: 'unknown' }).success,
    ).toBe(false)
  })

  it('delegates the badge and page to one public feed-head authority', () => {
    const source = readFileSync(
      'src/contexts/notification/server/notifications.ts',
      'utf8',
    )
    const feedHeadHandler = source
      .split('export const getNotificationFeedHeadFn')[1]
      ?.split('export const getNotificationsFn')[0]

    expect(feedHeadHandler).toBeDefined()
    expect(feedHeadHandler).toContain('notificationPublicApi.getFeedHead(')
    expect(feedHeadHandler).not.toContain('notificationPublicApi.getUnreadCount(')
    expect(feedHeadHandler).not.toContain('notificationPublicApi.getNotifications(')
  })

  it('has no separate unread-count endpoint or active UI surface', () => {
    const routes = readFileSync('src/routes/-notification-fns.ts', 'utf8')
    const bundle = readFileSync('src/components/features/notification/types.ts', 'utf8')
    const server = readFileSync(
      'src/contexts/notification/server/notifications.ts',
      'utf8',
    )

    expect(routes).not.toContain('getUnreadNotificationCountFn')
    expect(routes).not.toContain('getUnreadCount:')
    expect(bundle).not.toContain('getUnreadNotificationCountFn')
    expect(bundle).not.toContain('getUnreadCount:')
    expect(server).not.toContain('getUnreadNotificationCountFn')
    expect(server).not.toContain('notification.getUnreadCount')
  })
})
