import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database, Tx } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import { unbrand } from '#/shared/domain/ids'
import { notificationError } from '../domain/notification-errors'
import type { Notification } from '../domain/notification-types'
import { applyCoalescence } from '../domain/notification-policy'
import { notificationFromRow } from '../infrastructure/repositories/notification-row.mapper'

/**
 * Lock, read, merge, write attempts before giving up. A round only repeats
 * when the waiting row left its slot between the failed insert and the lock
 * (read, dismissed or settled), so a second round is rare and a fifth means
 * something is churning the row.
 */
const MAX_ROUNDS = 5

const waitingSlot = (notification: Notification) =>
  and(
    eq(notifications.userId, unbrand(notification.userId)),
    eq(notifications.type, notification.type),
    eq(notifications.resourceId, notification.resourceId),
    eq(notifications.status, 'unread'),
    isNull(notifications.resolvedAt),
  )

const insertFresh = async (tx: Tx, notification: Notification) => {
  const [row] = await tx
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
    // The partial unique index is the backstop: when another writer holds the
    // waiting slot this inserts nothing and the next round locks and merges
    // into that row instead.
    .onConflictDoNothing({
      target: [notifications.userId, notifications.type, notifications.resourceId],
      where: sql`status = 'unread' AND resolved_at IS NULL`,
    })
    .returning()
  return row ?? null
}

/**
 * The one writer of a notification row. At most one row per (user, type,
 * resource) waits on its reader, so a notice that lands on a waiting row is
 * absorbed into it: the row is locked, merged by `applyCoalescence` and
 * written back, and the merged row is returned. Otherwise the notice is
 * inserted as given. A returned `coalescedCount` above the notice's own means it was
 * absorbed.
 *
 * A notice stored already read (an email-only anchor) or settled sits outside
 * the waiting slot and is never absorbed into anything.
 */
export async function writeNotification(
  db: Database | Tx,
  notification: Notification,
): Promise<Notification> {
  const occupiesSlot = notification.status === 'unread'
  return db.transaction(async (tx) => {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      if (occupiesSlot) {
        const [waiting] = await tx
          .select()
          .from(notifications)
          .where(waitingSlot(notification))
          .for('update')
          .limit(1)
        if (waiting) {
          const merged = applyCoalescence(
            notificationFromRow(waiting),
            notification.payload,
            notification.updatedAt,
          )
          const [row] = await tx
            .update(notifications)
            .set({
              title: merged.title,
              body: merged.body,
              payload: merged.payload,
              coalescedCount: merged.coalescedCount,
              coalescedLatestAt: merged.coalescedLatestAt,
              updatedAt: merged.updatedAt,
            })
            .where(eq(notifications.id, waiting.id))
            .returning()
          if (!row) {
            throw notificationError('insert_failed', 'No row returned from coalescing')
          }
          return notificationFromRow(row)
        }
      }
      const inserted = await insertFresh(tx, notification)
      if (inserted) return notificationFromRow(inserted)
      if (!occupiesSlot) {
        throw notificationError(
          'insert_failed',
          'No row returned from notification INSERT',
        )
      }
    }
    throw notificationError(
      'insert_failed',
      'Notification kept losing its waiting slot to concurrent writers',
    )
  })
}
