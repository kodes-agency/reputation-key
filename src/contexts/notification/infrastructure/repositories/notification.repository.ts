// Notification context — Drizzle repository adapter for notifications
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq, desc, inArray, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { unbrand } from '#/shared/domain/ids'
import type { Notification, NotificationStatus } from '../../domain/types'
import { notificationFromRow } from './notification-row.mapper'
import { notificationError } from '../../domain/errors'

// ── Repository ──────────────────────────────────────────────────────

// Exclude notifications where the user opted out of in-app display for
// that type. Correlated NOT EXISTS against the sparse preference table.
const notOptedOutInApp = sql`NOT EXISTS (
  SELECT 1 FROM notification_preferences
  WHERE user_id = notifications.user_id
    AND organization_id = notifications.organization_id
    AND type = notifications.type
    AND in_app_enabled = false
)`

// Paginated, newest-first read of a user's visible notifications.
// `status` narrows to a single state (e.g. 'unread'); null returns all.
const selectUserNotifications = (
  db: Database,
  userId: string,
  orgId: string,
  limit: number,
  offset: number,
  status: NotificationStatus | null,
): Promise<Notification[]> => {
  const conditions = [
    eq(notifications.userId, userId),
    eq(notifications.organizationId, orgId),
    notOptedOutInApp,
  ]
  if (status) conditions.push(eq(notifications.status, status))
  return db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset)
    .then((rows) => rows.map(notificationFromRow))
}

export const createNotificationRepository = (db: Database) => ({
  // ── Mutations ────────────────────────────────────────────────────

  insert: async (notification: Notification): Promise<Notification> => {
    const row = await db
      .insert(notifications)
      .values({
        id: unbrand(notification.id),
        userId: unbrand(notification.userId),
        organizationId: unbrand(notification.organizationId),
        type: notification.type,
        priority: notification.priority,
        status: notification.status,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        eventId: notification.eventId,
        title: notification.title,
        body: notification.body,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          notifications.userId,
          notifications.type,
          notifications.resourceId,
          notifications.eventId,
        ],
        set: {
          title: notification.title,
          body: notification.body,
          priority: notification.priority,
          updatedAt: notification.updatedAt,
        },
      })
      .returning()

    const r = row[0]
    if (!r)
      throw notificationError('insert_failed', 'No row returned from notification INSERT')
    return notificationFromRow(r)
  },

  markRead: async (
    id: string,
    orgId: string,
    readAt: Date,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notifications)
      .set({ status: 'read', readAt, updatedAt })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.organizationId, orgId),
          eq(notifications.status, 'unread'),
        ),
      )
  },

  markAllRead: async (userId: string, orgId: string, updatedAt: Date): Promise<void> => {
    await db
      .update(notifications)
      .set({ status: 'read', readAt: updatedAt, updatedAt })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.organizationId, orgId),
          eq(notifications.status, 'unread'),
        ),
      )
  },
  updateStatus: async (
    id: string,
    orgId: string,
    status: NotificationStatus,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notifications)
      .set({ status, updatedAt })
      .where(and(eq(notifications.id, id), eq(notifications.organizationId, orgId)))
  },

  // ── Queries ──────────────────────────────────────────────────────

  findById: async (id: string, orgId: string): Promise<Notification | null> => {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.organizationId, orgId)))
      .limit(1)

    return rows[0] ? notificationFromRow(rows[0]) : null
  },
  findByIds: async (
    ids: readonly string[],
    orgId: string,
  ): Promise<Map<string, Notification>> => {
    if (ids.length === 0) return new Map()
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, orgId), inArray(notifications.id, ids)))
    const map = new Map<string, Notification>()
    for (const row of rows) {
      const n = notificationFromRow(row)
      map.set(n.id, n)
    }
    return map
  },

  findUnreadByUser: async (
    userId: string,
    orgId: string,
    limit: number,
    offset: number,
  ): Promise<Notification[]> =>
    selectUserNotifications(db, userId, orgId, limit, offset, 'unread'),

  countUnreadByUser: async (userId: string, orgId: string): Promise<number> => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.organizationId, orgId),
          eq(notifications.status, 'unread'),
          notOptedOutInApp,
        ),
      )

    return rows[0]!.count
  },

  findByUser: async (
    userId: string,
    orgId: string,
    limit: number,
    offset: number,
  ): Promise<Notification[]> =>
    selectUserNotifications(db, userId, orgId, limit, offset, null),
})
