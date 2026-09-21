// Feed notification surface — Drizzle repository adapter for notifications
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq, desc, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { unbrand } from '#/shared/domain/ids'
import type { Notification, NotificationStatus } from '../../domain/notification-types'
import { notificationFromRow } from './notification-row.mapper'
import { notificationError } from '../../domain/notification-errors'
import type { NotificationListFilter } from '../../application/notification-list-filter'
import { createNotificationPage } from '../../application/notification-page'

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

// Latest activity: a coalesced row sorts by its newest absorbed event, so a
// re-fired alert rises to the top instead of keeping its original slot while
// its timestamp says "just now". Must stay textually identical to the
// expression in notifications_feed_activity_idx, or every poll sorts again.
const lastActivityAt = sql`COALESCE(${notifications.coalescedLatestAt}, ${notifications.createdAt})`

// Paginated read of a user's visible notifications, newest activity first
// with id as the tiebreak so rows sharing an instant keep one order.
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
    .orderBy(desc(lastActivityAt), desc(notifications.id))
    .limit(limit)
    .offset(offset)
    .then((rows) => rows.map(notificationFromRow))
}

const countVisibleUnread = async (
  db: Database,
  userId: string,
  orgId: string,
): Promise<number> => {
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
        propertyId:
          notification.propertyId === null ? null : unbrand(notification.propertyId),
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
      // lookup, so it coalesces like the checked path (`applyCoalescence`):
      // bump the count, stamp the latest arrival, merge the payload newest-wins
      // with the count written in as `occurrences`. Live surfaces render from
      // that payload; the title/body snapshot is the fresh event's fallback.
      .onConflictDoUpdate({
        target: [notifications.userId, notifications.type, notifications.resourceId],
        targetWhere: sql`status = 'unread'`,
        set: {
          title: notification.title,
          body: notification.body,
          payload: sql`COALESCE(${notifications.payload}, '{}'::jsonb) || excluded.payload || jsonb_build_object('occurrences', ${notifications.coalescedCount} + 1)`,
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
    propertyId: string | null,
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
          propertyId === null
            ? isNull(notifications.propertyId)
            : eq(notifications.propertyId, propertyId),
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
  // the row matches exactly what the use case returned to the caller. The
  // lookup took no lock, so the row may have been read or dismissed since:
  // the status guard leaves such a row alone and reports the miss.
  refreshUnread: async (notification: Notification): Promise<boolean> => {
    const bumped = await db
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
          eq(notifications.status, 'unread'),
        ),
      )
      .returning({ id: notifications.id })
    return bumped.length > 0
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

  readFeedHead: async (
    userId: string,
    orgId: string,
    limit: number,
    filter: NotificationListFilter,
  ) =>
    db.transaction(
      async (tx) => {
        // The transaction handle has the same query surface as Database. Keep
        // the cast at this adapter boundary rather than weakening the port.
        const snapshot = tx as unknown as Database
        const rows = await selectUserNotifications(
          snapshot,
          userId,
          orgId,
          limit + 1,
          0,
          filter,
        )
        const unreadCount = await countVisibleUnread(snapshot, userId, orgId)
        const watermarkResult = await snapshot.execute(
          sql<{ watermark: Date | string }>`SELECT transaction_timestamp() AS watermark`,
        )
        const rawWatermark = watermarkResult.rows[0]?.watermark
        // node-postgres can return timestamptz either as Date or as text when
        // a process-level type parser is installed. Both represent the exact
        // transaction snapshot boundary; normalize once at the repository.
        const watermark =
          rawWatermark instanceof Date
            ? rawWatermark
            : new Date(String(rawWatermark ?? ''))
        if (Number.isNaN(watermark.getTime())) {
          throw notificationError(
            'query_failed',
            'Notification feed snapshot did not return a valid watermark',
          )
        }
        return {
          page: createNotificationPage(rows, limit),
          unreadCount,
          watermark: watermark.toISOString(),
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ),

  findByUser: async (
    userId: string,
    orgId: string,
    limit: number,
    offset: number,
    filter: NotificationListFilter,
  ): Promise<Notification[]> =>
    selectUserNotifications(db, userId, orgId, limit, offset, filter),
})
