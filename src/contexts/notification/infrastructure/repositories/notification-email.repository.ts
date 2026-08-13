// Notification context — Drizzle repository adapter for notification email queue
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notificationEmailQueue } from '#/shared/db/schema/notification.schema'
import {
  notificationEmailId,
  notificationId,
  organizationId as toOrgId,
  propertyId as toPropertyId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type {
  DeliveryErrorClass,
  EmailQueueStatus,
  NotificationCadence,
  NotificationCategory,
  NotificationEmail,
  NotificationPriority,
} from '../../domain/types'
import { notificationError } from '../../domain/errors'

type EmailRow = typeof notificationEmailQueue.$inferSelect

const emailFromRow = (row: EmailRow): NotificationEmail => ({
  id: notificationEmailId(row.id),
  notificationId: notificationId(row.notificationId),
  userId: toUserId(row.userId),
  organizationId: toOrgId(row.organizationId),
  propertyId: toPropertyId(row.propertyId),
  category: row.category as NotificationCategory,
  cadence: row.cadence as NotificationCadence,
  status: row.status as EmailQueueStatus,
  priority: row.priority as NotificationPriority,
  idempotencyKey: row.idempotencyKey,
  providerMessageId: row.providerMessageId,
  providerState: row.providerState,
  lastErrorClass: row.lastErrorClass as DeliveryErrorClass | null,
  suppressionReason: row.suppressionReason,
  notBefore: row.notBefore,
  nextAttemptAt: row.nextAttemptAt,
  attemptedAt: row.attemptedAt,
  acceptedAt: row.acceptedAt,
  deliveredAt: row.deliveredAt,
  bouncedAt: row.bouncedAt,
  sentAt: row.sentAt,
  failedAt: row.failedAt,
  retryCount: row.retryCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const scope = (id: string, orgId: string, propertyId: string) =>
  and(
    eq(notificationEmailQueue.id, id),
    eq(notificationEmailQueue.organizationId, orgId),
    eq(notificationEmailQueue.propertyId, propertyId),
  )

export const createNotificationEmailRepository = (db: Database) => ({
  insert: async (email: NotificationEmail): Promise<NotificationEmail> => {
    const rows = await db
      .insert(notificationEmailQueue)
      .values({
        id: email.id as string,
        notificationId: email.notificationId as string,
        userId: email.userId as string,
        organizationId: email.organizationId as string,
        propertyId: email.propertyId as string,
        category: email.category,
        cadence: email.cadence,
        status: email.status,
        priority: email.priority,
        idempotencyKey: email.idempotencyKey,
        providerMessageId: email.providerMessageId,
        providerState: email.providerState,
        lastErrorClass: email.lastErrorClass,
        suppressionReason: email.suppressionReason,
        notBefore: email.notBefore,
        nextAttemptAt: email.nextAttemptAt,
        attemptedAt: email.attemptedAt,
        acceptedAt: email.acceptedAt,
        deliveredAt: email.deliveredAt,
        bouncedAt: email.bouncedAt,
        sentAt: email.sentAt,
        failedAt: email.failedAt,
        retryCount: email.retryCount,
        createdAt: email.createdAt,
        updatedAt: email.updatedAt,
      })
      .onConflictDoNothing({
        target: [
          notificationEmailQueue.organizationId,
          notificationEmailQueue.propertyId,
          notificationEmailQueue.idempotencyKey,
        ],
      })
      .returning()
    if (rows[0]) return emailFromRow(rows[0])

    const existing = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, email.organizationId as string),
          eq(notificationEmailQueue.propertyId, email.propertyId as string),
          eq(notificationEmailQueue.idempotencyKey, email.idempotencyKey),
        ),
      )
      .limit(1)
    if (!existing[0])
      throw notificationError('insert_failed', 'Email queue INSERT returned no row')
    return emailFromRow(existing[0])
  },

  findById: async (
    id: string,
    orgId: string,
    propertyId: string,
  ): Promise<NotificationEmail | null> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(scope(id, orgId, propertyId))
      .limit(1)
    return rows[0] ? emailFromRow(rows[0]) : null
  },

  findDueByProperty: async (
    orgId: string,
    propertyId: string,
    cadence: string,
    now: Date,
  ): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, orgId),
          eq(notificationEmailQueue.propertyId, propertyId),
          eq(notificationEmailQueue.cadence, cadence),
          or(
            eq(notificationEmailQueue.status, 'pending'),
            eq(notificationEmailQueue.status, 'delayed'),
            and(
              eq(notificationEmailQueue.status, 'failed'),
              sql`${notificationEmailQueue.retryCount} < 5`,
            ),
          ),
          or(
            sql`${notificationEmailQueue.notBefore} IS NULL`,
            lte(notificationEmailQueue.notBefore, now),
          ),
          or(
            sql`${notificationEmailQueue.nextAttemptAt} IS NULL`,
            lte(notificationEmailQueue.nextAttemptAt, now),
          ),
        ),
      )
      .orderBy(asc(notificationEmailQueue.createdAt))
      .limit(500)
    return rows.map(emailFromRow)
  },

  markAccepted: async (
    id: string,
    orgId: string,
    propertyId: string,
    providerMessageId: string,
    acceptedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: 'accepted',
        providerMessageId,
        providerState: 'accepted',
        acceptedAt,
        sentAt: acceptedAt,
        attemptedAt: acceptedAt,
        lastErrorClass: null,
        nextAttemptAt: null,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, ['pending', 'failed', 'delayed']),
        ),
      )
  },

  markDelayed: async (
    id: string,
    orgId: string,
    propertyId: string,
    notBefore: Date,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({ status: 'delayed', notBefore, updatedAt })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, ['pending', 'failed', 'delayed']),
        ),
      )
  },

  markFailed: async (
    id: string,
    orgId: string,
    propertyId: string,
    classification: DeliveryErrorClass,
    nextAttemptAt: Date | null,
    failedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: classification === 'suppressed' ? 'suppressed' : 'failed',
        lastErrorClass: classification,
        failedAt,
        attemptedAt: failedAt,
        nextAttemptAt,
        retryCount: sql`${notificationEmailQueue.retryCount} + 1`,
        updatedAt: failedAt,
      })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, ['pending', 'failed', 'delayed']),
        ),
      )
  },

  markSuppressed: async (
    id: string,
    orgId: string,
    propertyId: string,
    reason: string,
    updatedAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: 'suppressed',
        providerState: 'suppressed',
        suppressionReason: reason,
        updatedAt,
      })
      .where(
        and(
          scope(id, orgId, propertyId),
          inArray(notificationEmailQueue.status, ['pending', 'failed', 'delayed']),
        ),
      )
  },

  recordProviderState: async (
    providerMessageId: string,
    state: 'delivered' | 'bounced' | 'complained',
    occurredAt: Date,
  ): Promise<void> => {
    await db
      .update(notificationEmailQueue)
      .set({
        status: state,
        providerState: state,
        ...(state === 'delivered'
          ? { deliveredAt: occurredAt }
          : { bouncedAt: occurredAt }),
        updatedAt: occurredAt,
      })
      .where(eq(notificationEmailQueue.providerMessageId, providerMessageId))
  },
})
