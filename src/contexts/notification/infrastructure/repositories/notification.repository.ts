// Notification context — Drizzle repository adapter for notifications
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq, desc, inArray, ne, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { unbrand } from '#/shared/domain/ids'
import type { Notification, NotificationStatus } from '../../domain/types'
import { notificationFromRow } from './notification-row.mapper'
import { notificationError } from '../../domain/errors'
import type { NotificationListFilter } from '../../application/notification-list-filter'

// ── Repository ──────────────────────────────────────────────────────

// Email-only notifications remain durable anchors, but are excluded from the
// in-app list when the concrete property/category/channel preference disables it.
const notOptedOutInApp = sql`NOT EXISTS (
  SELECT 1 FROM notification_preferences
  WHERE user_id = notifications.user_id
    AND organization_id = notifications.organization_id
    AND property_id = notifications.property_id
    AND category = notifications.category
    AND channel = 'in_app'
    AND enabled = false
    AND notifications.category NOT IN ('mandatory', 'urgent_operational')
)`

// Paginated, newest-first read of a user's visible notifications.
// The filter is applied BEFORE limit/offset so every returned page belongs to
// the requested feed. Dismissed rows are always hidden, not deleted.
const selectUserNotifications = (
  db: Database,
  userId: string,
  orgId: string,
  limit: number,
  offset: number,
  filter: NotificationListFilter,
): Promise<Notification[]> => {
  const conditions = [
    eq(notifications.userId, userId),
    eq(notifications.organizationId, orgId),
    notOptedOutInApp,
  ]
  conditions.push(ne(notifications.status, 'dismissed'))
  if (filter === 'unread') conditions.push(eq(notifications.status, 'unread'))
  else if (filter === 'urgent') conditions.push(eq(notifications.priority, 'urgent'))
  else if (filter !== 'all') conditions.push(eq(notifications.category, filter))
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
        propertyId: unbrand(notification.propertyId),
        type: notification.type,
        category: notification.category,
        priority: notification.priority,
        status: notification.status,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        eventId: notification.eventId,
        title: notification.title,
        body: notification.body,
        payload: notification.payload,
        coalescedCount: notification.coalescedCount,
        coalescedLatestAt: notification.coalescedLatestAt,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
      })
      // ADR 0046 r.2: the conflict target is now the PARTIAL unique index, so
      // drizzle needs its predicate (`targetWhere`) alongside the columns —
      // without the predicate PostgreSQL cannot infer which index arbitrates.
      // Reaching this branch means two events raced past the use case's unread
      // lookup, so it coalesces exactly like the checked path: bump the count,
      // stamp the latest arrival, re-store the freshly rendered copy.
      .onConflictDoUpdate({
        target: [notifications.userId, notifications.type, notifications.resourceId],
        targetWhere: sql`status = 'unread'`,
        set: {
          title: notification.title,
          body: notification.body,
          payload: notification.payload,
          priority: notification.priority,
          coalescedCount: sql`${notifications.coalescedCount} + 1`,
          coalescedLatestAt: notification.updatedAt,
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
    userId: string,
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
          eq(notifications.userId, userId),
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
    userId: string,
    orgId: string,
    status: NotificationStatus,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notifications)
      .set({ status, updatedAt })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          eq(notifications.organizationId, orgId),
        ),
      )
  },

  // ── Dedup: at most one unread per (user, type, resource) ──────────
  findUnreadByUserTypeResource: async (
    userId: string,
    orgId: string,
    propertyId: string,
    type: string,
    resourceId: string,
  ): Promise<Notification | null> => {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.organizationId, orgId),
          eq(notifications.propertyId, propertyId),
          eq(notifications.type, type),
          eq(notifications.resourceId, resourceId),
          eq(notifications.status, 'unread'),
        ),
      )
      .limit(1)
    return rows[0] ? notificationFromRow(rows[0]) : null
  },

  // ADR 0046 r.2 bump: persist the already-coalesced entity produced by
  // `applyCoalescence` — the re-rendered copy, the merged payload, the count
  // and the latest-arrival stamp. `updatedAt` is the entity's, not `now()`, so
  // the row matches exactly what the use case returned to the caller.
  refreshUnread: async (notification: Notification): Promise<void> => {
    await db
      .update(notifications)
      .set({
        title: notification.title,
        body: notification.body,
        payload: notification.payload,
        coalescedCount: notification.coalescedCount,
        coalescedLatestAt: notification.coalescedLatestAt,
        updatedAt: notification.updatedAt,
      })
      .where(
        and(
          eq(notifications.id, unbrand(notification.id)),
          eq(notifications.userId, unbrand(notification.userId)),
          eq(notifications.organizationId, unbrand(notification.organizationId)),
        ),
      )
  },

  // Read -> unread for the row menu. The partial unread-uniqueness index means
  // this flip can collide with an unread row that already covers the same
  // (user, type, resource), so the guard makes the collision a no-op (null)
  // instead of a raw PG unique violation surfacing as a 500.
  markUnread: async (
    id: string,
    userId: string,
    orgId: string,
    updatedAt: Date,
  ): Promise<Notification | null> => {
    const rows = await db
      .update(notifications)
      .set({ status: 'unread', readAt: null, updatedAt })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          eq(notifications.organizationId, orgId),
          eq(notifications.status, 'read'),
          sql`NOT EXISTS (
            SELECT 1 FROM notifications AS unread_sibling
             WHERE unread_sibling.user_id = ${userId}
               AND unread_sibling.type = notifications.type
               AND unread_sibling.resource_id = notifications.resource_id
               AND unread_sibling.status = 'unread'
          )`,
        ),
      )
      .returning()
    return rows[0] ? notificationFromRow(rows[0]) : null
  },

  // Clear-all: dismiss every non-dismissed notification for the user.
  markAllDismissed: async (
    userId: string,
    orgId: string,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notifications)
      .set({ status: 'dismissed', updatedAt })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.organizationId, orgId),
          ne(notifications.status, 'dismissed'),
        ),
      )
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
  findByIdForProperty: async (
    id: string,
    orgId: string,
    propertyId: string,
  ): Promise<Notification | null> => {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.organizationId, orgId),
          eq(notifications.propertyId, propertyId),
        ),
      )
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
  findByIdsForProperty: async (
    ids: readonly string[],
    orgId: string,
    propertyId: string,
  ): Promise<Map<string, Notification>> => {
    if (ids.length === 0) return new Map()
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, orgId),
          eq(notifications.propertyId, propertyId),
          inArray(notifications.id, ids),
        ),
      )
    const map = new Map<string, Notification>()
    for (const row of rows) {
      const notification = notificationFromRow(row)
      map.set(notification.id, notification)
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
    filter: NotificationListFilter,
  ): Promise<Notification[]> =>
    selectUserNotifications(db, userId, orgId, limit, offset, filter),
})
