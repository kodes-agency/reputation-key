// Story/test-only fixture factory; the `.stories.` segment keeps this module
// outside production-shaped source inventories and bundles.
//
// The old per-story `makeNotification` helpers force-cast their result
// (`as Notification`) while omitting required fields — `propertyId`,
// `category`, and now `payload` / `coalescedCount` / `coalescedLatestAt`. The
// rows render FROM `payload`, so a fixture missing it renders a different
// component than production does, and the cast hid that. This factory returns a
// complete `NotificationView` — the shape the browser receives — with no casts:
// adding a field to that view breaks compilation here, which is the point.
// The stored title/body snapshot is not in the view at all, so no surface can
// render it by accident.

import {
  classifyNotification,
  type NotificationFeedCursor,
  type NotificationFeedHead,
  type NotificationListFilter,
  type NotificationPage,
  type NotificationPayload,
  type NotificationPriority,
  type NotificationResourceType,
  type NotificationStatus,
  type NotificationType,
  type NotificationView,
} from '#/contexts/feed/application/public-api'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { NotificationUserSettings } from '#/contexts/feed/application/public-api'
import type { NotificationServerFns } from './types'
import { matchesNotificationFilter } from './notification-filters'

export type NotificationFixtureOverrides = Readonly<{
  id: string
  /** `null` for an Organization-scoped notice (mandatory, or ADR 0059). */
  propertyId?: string | null
  type?: NotificationType
  priority?: NotificationPriority
  status?: NotificationStatus
  resourceType?: NotificationResourceType
  resourceId?: string
  payload?: NotificationPayload
  coalescedCount?: number
  coalescedLatestAt?: Date | null
  createdAt?: Date
  readAt?: Date | null
}>

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export function makeNotification(
  overrides: NotificationFixtureOverrides,
): NotificationView {
  const type = overrides.type ?? 'review.created'
  const status = overrides.status ?? 'unread'
  const createdAt = overrides.createdAt ?? new Date(Date.now() - 5 * MINUTE)

  return {
    id: notificationId(overrides.id),
    propertyId:
      overrides.propertyId === null
        ? null
        : propertyId(overrides.propertyId ?? '33333333-3333-4333-8333-333333333333'),
    type,
    category: classifyNotification(type),
    priority: overrides.priority ?? 'normal',
    status,
    resourceType: overrides.resourceType ?? 'inbox_item',
    resourceId: overrides.resourceId ?? '44444444-4444-4444-8444-444444444444',
    payload: overrides.payload ?? {},
    coalescedCount: overrides.coalescedCount ?? 1,
    coalescedLatestAt: overrides.coalescedLatestAt ?? null,
    readAt: overrides.readAt ?? (status === 'read' ? new Date(Date.now() - HOUR) : null),
    createdAt,
  }
}

const RIVERSIDE = '33333333-3333-4333-8333-333333333333'
const HARBOUR = '66666666-6666-4666-8666-666666666666'

/**
 * A realistic mixed feed: urgent + unread + read, one row per metadata shape
 * the row has to survive. Ordered newest-first like the server returns it.
 */
export const notificationFixtures: ReadonlyArray<NotificationView> = [
  makeNotification({
    id: '10000000-0000-4000-8000-000000000001',
    type: 'inbox.escalated',
    priority: 'urgent',
    status: 'unread',
    propertyId: RIVERSIDE,
    payload: {
      propertyName: 'Riverside Hotel',
      guestRating: 2,
      platform: 'portal',
      waitingHours: 26,
      actorRole: 'property_manager',
    },
    createdAt: new Date(Date.now() - 12 * MINUTE),
  }),
  makeNotification({
    id: '10000000-0000-4000-8000-000000000002',
    type: 'reply.pending_approval',
    priority: 'urgent',
    status: 'unread',
    propertyId: RIVERSIDE,
    payload: { propertyName: 'Riverside Hotel', waitingHours: 5 },
    coalescedCount: 3,
    coalescedLatestAt: new Date(Date.now() - 20 * MINUTE),
    createdAt: new Date(Date.now() - 3 * HOUR),
  }),
  makeNotification({
    id: '10000000-0000-4000-8000-000000000003',
    type: 'feedback.created',
    status: 'unread',
    propertyId: HARBOUR,
    payload: {
      propertyName: 'Harbour View Suites',
      guestRating: 5,
      platform: 'portal',
    },
    createdAt: new Date(Date.now() - 90 * MINUTE),
  }),
  // No metadata at all — the row must shorten, never print "undefined".
  makeNotification({
    id: '10000000-0000-4000-8000-000000000004',
    type: 'inbox_note.added',
    status: 'read',
    propertyId: HARBOUR,
    payload: {},
    createdAt: new Date(Date.now() - 5 * HOUR),
  }),
]

/** A property name long enough to prove the row truncates instead of reflowing. */
export const longPropertyNameNotification: NotificationView = makeNotification({
  id: '10000000-0000-4000-8000-000000000006',
  type: 'review.created',
  status: 'unread',
  payload: {
    propertyName:
      'The Grand Riverside Boulevard Hotel, Conference Centre and Rooftop Spa Resort',
    platform: 'google',
  },
})

/** Property list the /notifications page uses to resolve group headings. */
export const notificationPropertyFixtures: ReadonlyArray<
  Readonly<{ id: string; name: string }>
> = [
  { id: RIVERSIDE, name: 'Riverside Hotel' },
  { id: HARBOUR, name: 'Harbour View Suites' },
]

export const notificationUserSettingsFixture = {
  userId: userId('11111111-1111-4111-8111-111111111111'),
  organizationId: organizationId('22222222-2222-4222-8222-222222222222'),
  locale: 'en-GB',
  timezone: 'Europe/London',
  quietHoursStart: null,
  quietHoursEnd: null,
  urgentBypassEnabled: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} satisfies NotificationUserSettings

/**
 * The position the server would mint for a row: latest activity as fixed-width
 * UTC with microseconds, then the id. A Date only has milliseconds, so the
 * fixture pads them.
 */
function feedCursorFixture(notification: NotificationView): NotificationFeedCursor {
  const at = (notification.coalescedLatestAt ?? notification.createdAt).toISOString()
  return { at: at.replace(/Z$/, '000Z'), id: notification.id }
}

export function notificationPageFixture(
  notifications: ReadonlyArray<NotificationView> = [],
  hasMore = false,
): NotificationPage {
  const last = notifications.at(-1)
  return {
    notifications,
    hasMore,
    nextCursor: hasMore && last ? feedCursorFixture(last) : null,
  }
}

/**
 * A head as the server answers it. The fixture is the All tab's, so its
 * filter's share of the unread count is the whole count.
 */
export function notificationFeedHeadFixture(
  notifications: ReadonlyArray<NotificationView> = [],
  unreadCount = notifications.filter((notification) => notification.status === 'unread')
    .length,
  hasMore = false,
): NotificationFeedHead {
  return {
    page: notificationPageFixture(notifications, hasMore),
    unreadCount,
    filterUnreadCount: unreadCount,
    watermark: 'fixture-feed-head',
  }
}

/**
 * A `NotificationServerFns` bundle for stories.
 *
 * The double casts are unavoidable and deliberately confined to this one
 * function: each server fn carries its own opaque brand, so a plain async
 * double is not assignable without one. Keeping them here means no story file
 * has to cast anything, and the RESULT is fully typed.
 */
export function makeNotificationFns(
  overrides: Partial<NotificationServerFns> = {},
): NotificationServerFns {
  // `unknown` in, branded fn out: each server fn carries its own opaque brand,
  // so a plain async double needs the two-step cast. It happens once, here.
  const stub =
    (value: unknown): unknown =>
    async () =>
      value

  const base: NotificationServerFns = {
    getFeedHead: stub(
      notificationFeedHeadFixture(),
    ) as NotificationServerFns['getFeedHead'],
    getList: stub(notificationPageFixture()) as NotificationServerFns['getList'],
    markRead: stub(undefined) as NotificationServerFns['markRead'],
    markUnread: stub(null) as NotificationServerFns['markUnread'],
    markAllRead: stub(undefined) as NotificationServerFns['markAllRead'],
    dismiss: stub(undefined) as NotificationServerFns['dismiss'],
    dismissAll: stub(undefined) as NotificationServerFns['dismissAll'],
    muteCategory: stub(undefined) as NotificationServerFns['muteCategory'],
    getUserSettings: stub(
      notificationUserSettingsFixture,
    ) as NotificationServerFns['getUserSettings'],
  }
  return { ...base, ...overrides }
}

type FeedRead = Readonly<{
  data: Readonly<{
    limit: number
    filter?: NotificationListFilter
    before?: NotificationFeedCursor
  }>
}>
type BulkRead = Readonly<{ data?: Readonly<{ filter?: NotificationListFilter }> }>
type RowCommand = Readonly<{ data: Readonly<{ notificationId: string }> }>
type MuteCommand = Readonly<{ data: Readonly<{ propertyId: string; category: string }> }>

/** Rows strictly after `cursor` in feed order, as the endpoint reads them. */
function rowsAfter(
  rows: ReadonlyArray<NotificationView>,
  cursor: NotificationFeedCursor,
): ReadonlyArray<NotificationView> {
  const at = Date.parse(cursor.at.replace(/(\.\d{3})\d{3}Z$/, '$1Z'))
  return rows.filter((row) => {
    const rowAt = (row.coalescedLatestAt ?? row.createdAt).getTime()
    return rowAt < at || (rowAt === at && row.id < cursor.id)
  })
}

/**
 * A `NotificationServerFns` bundle over rows the commands really change: the
 * head and "Load more" page the CURRENT rows by filter, limit and cursor, and
 * mark read, dismiss, mute and the bulk commands rewrite them ("Mark all
 * read" only the filter's rows). A story can act on one surface and watch
 * another read the result.
 */
export function makeStatefulNotificationFns(
  initial: ReadonlyArray<NotificationView>,
  overrides: Partial<NotificationServerFns> = {},
): NotificationServerFns {
  let rows = [...initial]
  const read = (row: NotificationView): NotificationView =>
    row.status === 'unread' ? { ...row, status: 'read', readAt: new Date() } : row
  const pageOf = (candidates: ReadonlyArray<NotificationView>, limit: number) =>
    notificationPageFixture(candidates.slice(0, limit), candidates.length > limit)

  const inFilter = (filter: NotificationListFilter = 'all') =>
    rows.filter((row) => matchesNotificationFilter(row, filter))
  const unread = (candidates: ReadonlyArray<NotificationView>) =>
    candidates.filter((row) => row.status === 'unread').length

  const server = {
    getFeedHead: async ({ data }: FeedRead): Promise<NotificationFeedHead> => ({
      page: pageOf(inFilter(data.filter), data.limit),
      unreadCount: unread(rows),
      filterUnreadCount: unread(inFilter(data.filter)),
      watermark: 'stateful-feed-head',
    }),
    getList: async ({ data }: FeedRead) => {
      const candidates = inFilter(data.filter)
      return pageOf(
        data.before ? rowsAfter(candidates, data.before) : candidates,
        data.limit,
      )
    },
    markRead: async ({ data }: RowCommand) => {
      rows = rows.map((row) => (row.id === data.notificationId ? read(row) : row))
    },
    dismiss: async ({ data }: RowCommand) => {
      rows = rows.filter((row) => row.id !== data.notificationId)
    },
    markAllRead: async ({ data }: BulkRead) => {
      const filter = data?.filter ?? 'all'
      rows = rows.map((row) => (matchesNotificationFilter(row, filter) ? read(row) : row))
    },
    dismissAll: async () => {
      rows = []
    },
    // The server hides every row of a muted in-app category for that Property.
    muteCategory: async ({ data }: MuteCommand) => {
      rows = rows.filter(
        (row) => row.propertyId !== data.propertyId || row.category !== data.category,
      )
    },
  }
  // Same two-step cast as `makeNotificationFns`, for the same reason.
  return makeNotificationFns({
    ...(server as unknown as Partial<NotificationServerFns>),
    ...overrides,
  })
}
