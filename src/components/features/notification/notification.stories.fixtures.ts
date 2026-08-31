// Story/test-only fixture factory; the `.stories.` segment keeps this module
// outside production-shaped source inventories and bundles.
//
// The old per-story `makeNotification` helpers force-cast their result
// (`as Notification`) while omitting required fields — `propertyId`,
// `category`, and now `payload` / `coalescedCount` / `coalescedLatestAt`. The
// rows render FROM `payload`, so a fixture missing it renders a different
// component than production does, and the cast hid that. This factory returns a
// complete `Notification` with no casts: adding a field to the domain type
// breaks compilation here, which is the point.

import {
  classifyNotification,
  type Notification,
  type NotificationPage,
  type NotificationPayload,
  type NotificationPriority,
  type NotificationResourceType,
  type NotificationStatus,
  type NotificationType,
} from '#/contexts/notification/application/public-api'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { NotificationUserSettings } from '#/contexts/notification/application/public-api'
import type { NotificationServerFns } from './types'

export type NotificationFixtureOverrides = Readonly<{
  id: string
  propertyId?: string
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
  /** The frozen pre-template snapshot. Live surfaces must NOT render it. */
  title?: string
  body?: string | null
}>

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export function makeNotification(overrides: NotificationFixtureOverrides): Notification {
  const type = overrides.type ?? 'review.created'
  const status = overrides.status ?? 'unread'
  const createdAt = overrides.createdAt ?? new Date(Date.now() - 5 * MINUTE)

  return {
    id: notificationId(overrides.id),
    userId: userId('11111111-1111-4111-8111-111111111111'),
    organizationId: organizationId('22222222-2222-4222-8222-222222222222'),
    propertyId: propertyId(
      overrides.propertyId ?? '33333333-3333-4333-8333-333333333333',
    ),
    type,
    category: classifyNotification(type),
    priority: overrides.priority ?? 'normal',
    status,
    resourceType: overrides.resourceType ?? 'inbox_item',
    resourceId: overrides.resourceId ?? '44444444-4444-4444-8444-444444444444',
    eventId: '55555555-5555-4555-8555-555555555555',
    // Deliberately a stale sentence: any story that shows this string on screen
    // has bypassed `renderNotification`, which is exactly the bug to catch.
    title: overrides.title ?? 'LEGACY SNAPSHOT TITLE',
    body: overrides.body ?? 'LEGACY SNAPSHOT BODY',
    payload: overrides.payload ?? {},
    coalescedCount: overrides.coalescedCount ?? 1,
    coalescedLatestAt: overrides.coalescedLatestAt ?? null,
    readAt: overrides.readAt ?? (status === 'read' ? new Date(Date.now() - HOUR) : null),
    createdAt,
    updatedAt: createdAt,
  }
}

const RIVERSIDE = '33333333-3333-4333-8333-333333333333'
const HARBOUR = '66666666-6666-4666-8666-666666666666'

/**
 * A realistic mixed feed: urgent + unread + read, one row per metadata shape
 * the row has to survive. Ordered newest-first like the server returns it.
 */
export const notificationFixtures: ReadonlyArray<Notification> = [
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
  makeNotification({
    id: '10000000-0000-4000-8000-000000000005',
    // Retained compatibility row: the Badge program is beta-dark, but an
    // already-persisted notification must remain readable in history.
    type: 'badge.awarded',
    status: 'read',
    resourceType: 'badge',
    propertyId: HARBOUR,
    payload: {
      propertyName: 'Harbour View Suites',
      badgeName: 'Response Champ',
      recipientName: 'You',
    },
    createdAt: new Date(Date.now() - 30 * HOUR),
  }),
]

/** A property name long enough to prove the row truncates instead of reflowing. */
export const longPropertyNameNotification: Notification = makeNotification({
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
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
} satisfies NotificationUserSettings

export function notificationPageFixture(
  notifications: ReadonlyArray<Notification> = [],
  hasMore = false,
): NotificationPage {
  return { notifications, hasMore }
}

export function notificationFeedHeadFixture(
  notifications: ReadonlyArray<Notification> = [],
  unreadCount = notifications.filter((notification) => notification.status === 'unread')
    .length,
  hasMore = false,
) {
  return {
    page: notificationPageFixture(notifications, hasMore),
    unreadCount,
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
