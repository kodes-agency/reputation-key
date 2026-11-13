// Feed notification surface — the reader's feed: one snapshot head, keyset
// pages, and the bulk "Mark all read" / "Clear all" actions over what the feed
// shows.

import { and, eq, ne, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { notificationError } from '../domain/notification-errors'
import type { NotificationListFilter } from '../application/notification-list-filter'
import { createNotificationPage } from '../application/notification-page'
import {
  countVisibleUnread,
  feedFilterCondition,
  inPropertyFilter,
  notOptedOutInApp,
  selectFeedRows,
  withinVisibleProperties,
  type NotificationFeedPageQuery,
  type NotificationFeedQuery,
  type NotificationFeedScope,
} from './notification-feed-sql.server'

export type { NotificationFeedQuery, NotificationFeedScope }

// "Mark all read" on the tab the reader is on: the unread rows its filter
// holds, not the Organization's every unread row.
export const markAllNotificationsRead = async (
  db: Database,
  scope: NotificationFeedScope,
  filter: NotificationListFilter,
  updatedAt: Date,
): Promise<void> => {
  await db
    .update(notifications)
    .set({ status: 'read', readAt: updatedAt, updatedAt })
    .where(
      and(
        eq(notifications.userId, scope.userId),
        eq(notifications.organizationId, scope.organizationId),
        eq(notifications.status, 'unread'),
        feedFilterCondition(filter),
        // Only what the tab showed and counted: a row hidden by revoked
        // Property access or an in-app opt-out must come back unread.
        notOptedOutInApp,
        withinVisibleProperties(scope.visiblePropertyIds),
        inPropertyFilter(scope.propertyId),
      ),
    )
}

// Clear-all: dismiss every notification the reader's feed shows.
export const markAllNotificationsDismissed = async (
  db: Database,
  scope: NotificationFeedScope,
  updatedAt: Date,
): Promise<void> => {
  await db
    .update(notifications)
    .set({ status: 'dismissed', updatedAt })
    .where(
      and(
        eq(notifications.userId, scope.userId),
        eq(notifications.organizationId, scope.organizationId),
        ne(notifications.status, 'dismissed'),
        notOptedOutInApp,
        withinVisibleProperties(scope.visiblePropertyIds),
        inPropertyFilter(scope.propertyId),
      ),
    )
}

export const readNotificationFeedHead = async (
  db: Database,
  query: NotificationFeedQuery,
) =>
  db.transaction(
    async (tx) => {
      const snapshot = tx
      const rows = await selectFeedRows(snapshot, { ...query, before: null })
      const counts = await countVisibleUnread(snapshot, query)
      const watermarkResult = await snapshot.execute(
        sql<{ watermark: Date | string }>`SELECT transaction_timestamp() AS watermark`,
      )
      const rawWatermark = watermarkResult.rows[0]?.watermark
      // node-postgres can return timestamptz either as Date or as text when
      // a process-level type parser is installed. Both represent the exact
      // transaction snapshot boundary; normalize once at the repository.
      const watermark =
        rawWatermark instanceof Date ? rawWatermark : new Date(String(rawWatermark ?? ''))
      if (Number.isNaN(watermark.getTime())) {
        throw notificationError(
          'query_failed',
          'Notification feed snapshot did not return a valid watermark',
        )
      }
      return {
        page: createNotificationPage(rows, query.limit),
        ...counts,
        watermark: watermark.toISOString(),
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )

/** One keyset page below the head: rows strictly after `before`. */
export const readNotificationFeedPage = async (
  db: Database,
  query: NotificationFeedPageQuery,
) => createNotificationPage(await selectFeedRows(db, query), query.limit)
