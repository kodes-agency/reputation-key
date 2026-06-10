// Notification context — Drizzle repository adapter for notifications
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq, desc, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { unbrand } from '#/shared/domain/ids'
import {
  notificationId,
  userId as toUserId,
  organizationId as toOrgId,
} from '#/shared/domain/ids'
import type {
  Notification,
  NotificationType,
  NotificationPriority,
  NotificationStatus,
  NotificationResourceType,
} from '../../domain/types'

// ── Row → Domain mapper ─────────────────────────────────────────────

type NotificationRow = typeof notifications.$inferSelect

const notificationFromRow = (row: NotificationRow): Notification => ({
  id: notificationId(row.id),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  type: row.type as NotificationType,
  priority: row.priority as NotificationPriority,
  status: row.status as NotificationStatus,
  resourceType: row.resourceType as NotificationResourceType,
  resourceId: row.resourceId,
  eventId: row.eventId,
  title: row.title,
  body: row.body,
  readAt: row.readAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

// ── Repository ──────────────────────────────────────────────────────

export const createNotificationRepository = (db: Database) => ({
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
          status: notification.status,
          updatedAt: notification.updatedAt,
        },
      })
      .returning()

    return notificationFromRow(row[0]!)
  },

  findById: async (id: string, orgId: string): Promise<Notification | null> => {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.organizationId, orgId)))
      .limit(1)

    return rows[0] ? notificationFromRow(rows[0]) : null
  },

  findUnreadByUser: async (
    userId: string,
    limit: number,
    offset: number,
  ): Promise<Notification[]> => {
    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'unread')))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset)

    return rows.map(notificationFromRow)
  },

  countUnreadByUser: async (userId: string): Promise<number> => {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'unread')))

    return rows[0]!.count
  },

  findByUser: async (
    userId: string,
    limit: number,
    offset: number,
  ): Promise<Notification[]> => {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset)

    return rows.map(notificationFromRow)
  },

  markRead: async (id: string, orgId: string, readAt: Date): Promise<void> => {
    await db
      .update(notifications)
      .set({ status: 'read', readAt, updatedAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.organizationId, orgId)))
  },

  markAllRead: async (userId: string): Promise<void> => {
    await db
      .update(notifications)
      .set({ status: 'read', readAt: new Date(), updatedAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.status, 'unread')))
  },
})
