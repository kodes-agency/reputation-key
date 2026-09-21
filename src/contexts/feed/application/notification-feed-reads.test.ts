import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, userId, type PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { NotificationFeedQuery } from './ports/notification-repository.port'
import { createNotificationFeedReads } from './notification-feed-reads'

const HARBOR = propertyId('84000000-0000-4000-8000-000000000002')
const READER = {
  userId: userId('user-notification-reads'),
  organizationId: organizationId('org-notification-reads'),
} as const

function readsFor(accessible: ReadonlyArray<PropertyId> | null) {
  const heads: NotificationFeedQuery[] = []
  const pages: NotificationFeedQuery[] = []
  const propertyAccess = vi.fn(async () => accessible)
  const reads = createNotificationFeedReads({
    propertyAccess,
    repo: {
      readFeedHead: async (query) => {
        heads.push(query)
        return {
          page: { notifications: [], hasMore: false, nextCursor: null },
          unreadCount: 0,
          watermark: '2026-09-22T09:00:00.000Z',
        }
      },
      readFeedPage: async (query) => {
        pages.push(query)
        return { notifications: [], hasMore: false, nextCursor: null }
      },
    },
  })
  return { reads, heads, pages, propertyAccess }
}

describe('notification feed reads follow current Property access', () => {
  it('scopes an assigned-Property manager to the Properties they can still access', async () => {
    const { reads, heads, pages, propertyAccess } = readsFor([HARBOR])
    const manager: AuthContext = { ...READER, role: 'PropertyManager' }
    const before = { at: '2026-09-01T12:00:00.000000Z', id: HARBOR }

    await reads.getFeedHead(manager, { limit: 20, filter: 'all' })
    await reads.getNotifications(manager, { limit: 20, filter: 'unread', before })

    expect(propertyAccess).toHaveBeenCalledWith(
      READER.organizationId,
      READER.userId,
      false,
    )
    expect(heads).toEqual([
      { ...READER, visiblePropertyIds: [HARBOR], limit: 20, filter: 'all' },
    ])
    expect(pages).toEqual([
      { ...READER, visiblePropertyIds: [HARBOR], limit: 20, filter: 'unread', before },
    ])
  })

  it('leaves an Organization-wide reader unscoped without a lookup', async () => {
    const { reads, heads, propertyAccess } = readsFor([HARBOR])

    await reads.getFeedHead(
      { ...READER, role: 'AccountAdmin' },
      { limit: 20, filter: 'all' },
    )

    expect(propertyAccess).not.toHaveBeenCalled()
    expect(heads[0]?.visiblePropertyIds).toBeNull()
  })

  it('keeps only Organization notices when notification.read has no data scope', async () => {
    const { reads, heads } = readsFor([HARBOR])
    const unscoped: AuthContext = {
      ...READER,
      role: 'PropertyManager',
      scopeByPermission: new Map([['inbox.read', 'assigned-properties']]),
    }

    await reads.getFeedHead(unscoped, { limit: 20, filter: 'all' })

    expect(heads[0]?.visiblePropertyIds).toEqual([])
  })
})
