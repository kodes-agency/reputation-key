// Feed notification surface — the notification rows: the one coalescing
// writer, settlement, read state and lookups.

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationEmailQueue,
  notifications,
} from '#/shared/db/schema/notification.schema'
import {
  notificationId,
  userId,
  type NotificationId,
  type UserId,
} from '#/shared/domain/ids'
import type { Notification, NotificationStatus } from '../domain/notification-types'
import { notificationFromRow } from '../infrastructure/repositories/notification-row.mapper'
import { isCurrentInboxAssignee } from '#/contexts/reputation/application/public-api'
import { SENDABLE } from '../infrastructure/repositories/notification-email-queue-rows'
import {
  awaitingSettlement,
  mayBecomeUnread,
  stillWaiting,
} from './notification-feed-sql.server'

type NotificationRow = typeof notifications.$inferSelect

const firstNotification = (rows: readonly NotificationRow[]): Notification | null =>
  rows[0] ? notificationFromRow(rows[0]) : null

const notificationsById = (rows: readonly NotificationRow[]): Map<string, Notification> =>
  new Map(rows.map((row) => [row.id, notificationFromRow(row)]))

// Stamps the still-waiting rows of the given types that `scope` selects and
// returns their ids. `waiting` says how far along a row may be and still count.
const settleWhere = async (
  db: Database,
  input: {
    organizationId: string
    types: ReadonlyArray<string>
    resolvedAt: Date
    waiting: SQL
    scope: ReadonlyArray<SQL | undefined>
  },
): Promise<readonly NotificationId[]> => {
  if (input.types.length === 0) return []
  const settled = await db
    .update(notifications)
    .set({ resolvedAt: input.resolvedAt, updatedAt: input.resolvedAt })
    .where(
      and(
        eq(notifications.organizationId, input.organizationId),
        ...input.scope,
        inArray(notifications.type, [...input.types]),
        input.waiting,
      ),
    )
    .returning({ id: notifications.id })
  return settled.map((row) => notificationId(row.id))
}

// Who was told. Read state is irrelevant: somebody who read the escalation
// notice was still told about it, and a settled row still proves it. The
// latest arrival is the one a repeat event coalesced in, so a row first
// written for an earlier occurrence still counts once it was told again.
export const findRecipientsOfNotice = async (
  db: Database,
  orgId: string,
  type: string,
  resourceId: string,
  arrivedSince: Date | null,
): Promise<readonly UserId[]> => {
  const rows = await db
    .selectDistinct({ userId: notifications.userId })
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.type, type),
        eq(notifications.resourceId, resourceId),
        arrivedSince === null
          ? undefined
          : sql`COALESCE(${notifications.coalescedLatestAt}, ${notifications.createdAt}) >= ${arrivedSince}`,
      ),
    )
  return rows.map((row) => userId(row.userId))
}

// The work a notice asked for is done. Every recipient's still-waiting row
// about that resource is stamped, email-only anchors included, and the ids
// come back so the caller can cancel the mail queued behind them. `status`
// is deliberately untouched: read is not resolved (docs/BETA.md). Rows
// already resolved are excluded, so a redelivered fact settles nothing
// twice and cancels no mail a later event queued.
export const settleUnreadForResource = (
  db: Database,
  input: {
    organizationId: string
    types: ReadonlyArray<string>
    resourceId: string
    resolvedAt: Date
  },
): Promise<readonly NotificationId[]> =>
  settleWhere(db, {
    organizationId: input.organizationId,
    types: input.types,
    resolvedAt: input.resolvedAt,
    waiting: awaitingSettlement,
    scope: [eq(notifications.resourceId, input.resourceId)],
  })

export const settleUnreadForReader = (
  db: Database,
  input: {
    organizationId: string
    userId: string
    types: ReadonlyArray<string>
    /** Only rows of these categories; absent or null for any. */
    categories?: ReadonlyArray<string> | null
    /** Only rows still waiting in the app, never an email-only anchor. */
    inAppOnly?: boolean
    supersededByEventId?: string
    resourceId: string
    resolvedAt: Date
  },
): Promise<readonly NotificationId[]> =>
  settleWhere(db, {
    organizationId: input.organizationId,
    types: input.types,
    resolvedAt: input.resolvedAt,
    waiting: input.inAppOnly ? stillWaiting : awaitingSettlement,
    scope: [
      eq(notifications.userId, input.userId),
      eq(notifications.resourceId, input.resourceId),
      input.categories
        ? inArray(notifications.category, [...input.categories])
        : undefined,
      // The row can have absorbed a newer assignment while this removal
      // waited in either queue. Its original event id then still names the
      // old assignment. Item command revisions order assignment facts even
      // when application clocks repeat or move backwards.
      input.supersededByEventId
        ? sql`0 = (
                SELECT count(*) FROM outbox_events ended
                WHERE ended.id = ${input.supersededByEventId}::uuid
                  AND ended.organization_id = ${input.organizationId}
                  AND ended.source_aggregate_id = ${notifications.resourceId}
                  AND (
                    ${isCurrentInboxAssignee(
                      sql`${notifications.organizationId}`,
                      sql`${notifications.resourceId}`,
                      sql`${notifications.userId}`,
                      sql`(ended.payload->>'commandRevision')::bigint`,
                    )}
                    OR EXISTS (
                      SELECT 1 FROM outbox_events assigned
                      WHERE assigned.organization_id = ${input.organizationId}
                        AND assigned.source_aggregate_id = ended.source_aggregate_id
                        AND assigned.event_type = 'inbox.inbox_item.assigned'
                        AND assigned.payload->>'assignedTo' = ${notifications.userId}
                        AND (assigned.payload->>'commandRevision')::bigint >
                            (ended.payload->>'commandRevision')::bigint
                    )
                  )
              )`
        : undefined,
    ],
  })

export const settleUnreadForProperty = (
  db: Database,
  input: {
    organizationId: string
    propertyId: string
    types: ReadonlyArray<string>
    resolvedAt: Date
  },
): Promise<readonly NotificationId[]> =>
  settleWhere(db, {
    organizationId: input.organizationId,
    types: input.types,
    resolvedAt: input.resolvedAt,
    waiting: awaitingSettlement,
    scope: [eq(notifications.propertyId, input.propertyId)],
  })

export const saveNotificationRead = async (
  db: Database,
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
}

export const saveNotificationStatus = async (
  db: Database,
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
}

// ── Dedup: at most one waiting row per (user, type, resource) ─────
// Waiting, not merely unread: a settled row is done, so a new request on
// the resource starts a row of its own rather than reviving it.
export const findUnreadNotificationByUserTypeResource = async (
  db: Database,
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
        stillWaiting,
      ),
    )
    .limit(1)
  return firstNotification(rows)
}

// Read -> unread for the row menu. The partial unread-uniqueness index means
// this flip can collide with a waiting row that already covers the same
// (user, type, resource), so the guard makes the collision a no-op (null)
// instead of a raw PG unique violation surfacing as a 500. A settled row on
// either side sits outside the index and cannot collide.
export const saveNotificationUnread = async (
  db: Database,
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
        mayBecomeUnread(userId),
      ),
    )
    .returning()
  return firstNotification(rows)
}

/**
 * Dismissed -> read or unread: a dismissal's undo. `status` is what the row
 * was before it went (`saveRestoredNotification`). It comes back unread
 * only while no other waiting row holds its (user, type, resource) unread
 * key, the guard `markUnread` uses; otherwise it comes back read, stamped
 * now, so it never passes for an email-only anchor (read, no read time).
 * Resolves to the restored row, or null when no dismissed row matched.
 */
export const saveRestoredNotification = async (
  db: Database,
  id: string,
  userId: string,
  orgId: string,
  status: 'read' | 'unread',
  updatedAt: Date,
): Promise<Notification | null> => {
  const dismissedRow = and(
    eq(notifications.id, id),
    eq(notifications.userId, userId),
    eq(notifications.organizationId, orgId),
    eq(notifications.status, 'dismissed'),
  )
  if (status === 'unread') {
    const unread = await db
      .update(notifications)
      .set({ status: 'unread', updatedAt })
      .where(and(dismissedRow, mayBecomeUnread(userId)))
      .returning()
    if (unread[0]) return notificationFromRow(unread[0])
  }
  const read = await db
    .update(notifications)
    .set(
      status === 'unread'
        ? { status: 'read', readAt: updatedAt, updatedAt }
        : { status: 'read', updatedAt },
    )
    .where(dismissedRow)
    .returning()
  return firstNotification(read)
}

export const findNotificationById = async (
  db: Database,
  id: string,
  orgId: string,
): Promise<Notification | null> => {
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.organizationId, orgId)))
    .limit(1)

  return firstNotification(rows)
}

export const findNotificationByIdForProperty = async (
  db: Database,
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
  return firstNotification(rows)
}

export const findNotificationsByIdsForProperty = async (
  db: Database,
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
  return notificationsById(rows)
}

/**
 * The work these notices asked for is done, so the mail behind them has
 * nothing left to announce. `cancelled` is terminal (ADR 0046 r.6); only a
 * still-sendable row is moved, so a row the provider may already have
 * accepted is left exactly as it stands.
 */
export const cancelQueuedEmailsForNotifications = async (
  db: Database,
  notificationIds: ReadonlyArray<string>,
  orgId: string,
  reason: string,
  updatedAt: Date,
): Promise<number> => {
  if (notificationIds.length === 0) return 0
  const rows = await db
    .update(notificationEmailQueue)
    .set({
      status: 'cancelled',
      suppressionReason: reason,
      nextAttemptAt: null,
      providerRequest: null,
      updatedAt,
    })
    .where(
      and(
        eq(notificationEmailQueue.organizationId, orgId),
        inArray(notificationEmailQueue.notificationId, [...notificationIds]),
        inArray(notificationEmailQueue.status, [...SENDABLE]),
      ),
    )
    .returning({ id: notificationEmailQueue.id })
  return rows.length
}
