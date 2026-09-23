// Feed notification surface — Drizzle repository adapter for notifications
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, eq, desc, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { notificationId, unbrand, type NotificationId } from '#/shared/domain/ids'
import type { Notification, NotificationStatus } from '../../domain/notification-types'
import { notificationFromRow } from './notification-row.mapper'
import { notificationError } from '../../domain/notification-errors'
import type { NotificationListFilter } from '../../application/notification-list-filter'
import {
  createNotificationPage,
  type NotificationFeedCursor,
  type NotificationFeedRow,
} from '../../application/notification-page'

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

// The cursor half of the keyset: the latest-activity instant as fixed-width
// UTC text with microseconds. A JS Date keeps only milliseconds, so a cursor
// built from one could split two rows that share a millisecond.
const lastActivityCursorAt = sql<string>`to_char(${lastActivityAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

type NotificationFeedQuery = Readonly<{
  userId: string
  organizationId: string
  /** Current Property access; null reads every Property. */
  visiblePropertyIds: ReadonlyArray<string> | null
  filter: NotificationListFilter
  limit: number
}>

// A Property notice is shown only while the reader can still access that
// Property: access can end after delivery (a revoked or expired grant), and
// the rows must not outlive it in the feed or the badge. Organization-scoped
// notices have no Property and are never gated. Undefined: no restriction.
const withinVisibleProperties = (
  visiblePropertyIds: ReadonlyArray<string> | null,
): SQL | undefined => {
  if (visiblePropertyIds === null) return undefined
  if (visiblePropertyIds.length === 0) return isNull(notifications.propertyId)
  return or(
    isNull(notifications.propertyId),
    inArray(notifications.propertyId, [...visiblePropertyIds]),
  )
}

// What "unread" means to the bell and to the Unread tab: still waiting on the
// reader. A row whose work was settled upstream keeps its unread status — read
// is not resolved — but stops asking, so it leaves the count and the tab and
// stays in the feed under its "Done" marker.
const stillWaiting: SQL = and(
  eq(notifications.status, 'unread'),
  isNull(notifications.resolvedAt),
)!

// What a feed filter adds to "the reader's notices": the unread status, the
// urgent priority flag (any category), or one category. `all` adds nothing.
// Shared by the feed read, its filter's unread count and the filter-scoped
// "Mark all read", so the three can never disagree about a tab's rows.
const feedFilterCondition = (filter: NotificationListFilter): SQL | undefined => {
  if (filter === 'all') return undefined
  if (filter === 'unread') return stillWaiting
  if (filter === 'urgent') return eq(notifications.priority, 'urgent')
  return eq(notifications.category, filter)
}

type NotificationFeedPageQuery = NotificationFeedQuery &
  Readonly<{
    /** Continue strictly after this position; null reads from the top. */
    before: NotificationFeedCursor | null
  }>

// Keyset read of a user's visible notifications, newest activity first with id
// as the tiebreak so rows sharing an instant keep one order. A page continues
// strictly after the previous page's last row, so rows arriving above it or
// leaving above it can neither shift it nor make it skip a row.
// The filter is applied BEFORE the limit so every returned page belongs to
// the requested feed. Dismissed rows are always hidden, not deleted.
// Reads `limit + 1` rows: the extra one is has-more evidence for the page.
const selectFeedRows = (
  db: Database,
  query: NotificationFeedPageQuery,
): Promise<NotificationFeedRow[]> => {
  const conditions = [
    eq(notifications.userId, query.userId),
    eq(notifications.organizationId, query.organizationId),
    notOptedOutInApp,
    withinVisibleProperties(query.visiblePropertyIds),
    ne(notifications.status, 'dismissed'),
    feedFilterCondition(query.filter),
  ]
  if (query.before) {
    conditions.push(
      sql`(${lastActivityAt}, ${notifications.id}) < (${query.before.at}::timestamptz, ${query.before.id}::uuid)`,
    )
  }
  return db
    .select({ row: notifications, cursorAt: lastActivityCursorAt })
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(lastActivityAt), desc(notifications.id))
    .limit(query.limit + 1)
    .then((rows) =>
      rows.map(({ row, cursorAt }) => ({
        notification: notificationFromRow(row),
        cursor: { at: cursorAt, id: row.id },
      })),
    )
}

/**
 * The reader's visible unread rows, and how many of them the head's filter
 * holds (the rows that filter's "Mark all read" would change). One scan.
 */
const countVisibleUnread = async (
  db: Database,
  query: NotificationFeedQuery,
): Promise<Readonly<{ unreadCount: number; filterUnreadCount: number }>> => {
  const inFilter = feedFilterCondition(query.filter) ?? sql`true`
  const rows = await db
    .select({
      unreadCount: sql<number>`count(*)::int`,
      filterUnreadCount: sql<number>`(count(*) FILTER (WHERE ${inFilter}))::int`,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, query.userId),
        eq(notifications.organizationId, query.organizationId),
        stillWaiting,
        notOptedOutInApp,
        withinVisibleProperties(query.visiblePropertyIds),
      ),
    )

  return rows[0]!
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

  // The work a notice asked for is done. Every recipient's still-waiting row
  // about that resource is stamped, whatever their read state, and the ids
  // come back so the caller can cancel the mail queued behind them. `status`
  // is deliberately untouched: read is not resolved (docs/BETA.md). Rows
  // already resolved are excluded, so a redelivered fact settles nothing
  // twice and cancels no mail a later event queued.
  settleUnreadForResource: async (input: {
    organizationId: string
    types: ReadonlyArray<string>
    resourceId: string
    resolvedAt: Date
  }): Promise<readonly NotificationId[]> => {
    if (input.types.length === 0) return []
    const settled = await db
      .update(notifications)
      .set({ resolvedAt: input.resolvedAt, updatedAt: input.resolvedAt })
      .where(
        and(
          eq(notifications.organizationId, input.organizationId),
          eq(notifications.resourceId, input.resourceId),
          inArray(notifications.type, [...input.types]),
          stillWaiting,
        ),
      )
      .returning({ id: notifications.id })
    return settled.map((row) => notificationId(row.id))
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

  // "Mark all read" on the tab the reader is on: the unread rows its filter
  // holds, not the Organization's every unread row.
  markAllRead: async (
    userId: string,
    orgId: string,
    filter: NotificationListFilter,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notifications)
      .set({ status: 'read', readAt: updatedAt, updatedAt })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.organizationId, orgId),
          eq(notifications.status, 'unread'),
          feedFilterCondition(filter),
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

  readFeedHead: async (query: NotificationFeedQuery) =>
    db.transaction(
      async (tx) => {
        // The transaction handle has the same query surface as Database. Keep
        // the cast at this adapter boundary rather than weakening the port.
        const snapshot = tx as unknown as Database
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
          page: createNotificationPage(rows, query.limit),
          ...counts,
          watermark: watermark.toISOString(),
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ),

  /** One keyset page below the head: rows strictly after `before`. */
  readFeedPage: async (query: NotificationFeedPageQuery) =>
    createNotificationPage(await selectFeedRows(db, query), query.limit),
})
