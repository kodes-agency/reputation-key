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
import type {
  NotificationEmailRecipient,
  ProviderStateTransition,
} from '../../application/ports/notification-email-repository.port'
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

/** Statuses a row can still be sent from. */
const SENDABLE: readonly EmailQueueStatus[] = ['pending', 'failed', 'delayed']

/**
 * "Due" = still sendable, retry budget intact, and both time gates open.
 * Shared by the property-scoped and the recipient-scoped reads so the digest
 * sweep and the orphan sweep can never disagree about what is due.
 */
const dueForCadence = (cadence: string, now: Date) =>
  and(
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
  )

/**
 * ADR 0046 r.6 is a state MACHINE, not a last-writer-wins field. Provider
 * webhooks arrive out of order often enough that a late `delivered` would
 * otherwise erase a `bounced` and we would keep mailing a dead address.
 * `delivered` may only advance an accepted row; the negative terminals may
 * also overwrite `delivered`, never each other's row a second time.
 */
const PROVIDER_STATE_PREDECESSORS: Readonly<
  Record<'delivered' | 'bounced' | 'complained', readonly EmailQueueStatus[]>
> = {
  delivered: ['accepted'],
  bounced: ['accepted', 'delivered'],
  complained: ['accepted', 'delivered'],
}

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
          dueForCadence(cadence, now),
        ),
      )
      .orderBy(asc(notificationEmailQueue.createdAt))
      .limit(500)
    return rows.map(emailFromRow)
  },

  findDueRecipients: async (
    cadence: string,
    now: Date,
  ): Promise<readonly NotificationEmailRecipient[]> => {
    const rows = await db
      .selectDistinct({
        organizationId: notificationEmailQueue.organizationId,
        userId: notificationEmailQueue.userId,
      })
      .from(notificationEmailQueue)
      .where(dueForCadence(cadence, now))
      .orderBy(
        asc(notificationEmailQueue.organizationId),
        asc(notificationEmailQueue.userId),
      )
      .limit(5_000)
    return rows.map((row) => ({
      organizationId: toOrgId(row.organizationId),
      userId: toUserId(row.userId),
    }))
  },

  findDueByUser: async (
    orgId: string,
    userId: string,
    cadence: string,
    now: Date,
  ): Promise<NotificationEmail[]> => {
    const rows = await db
      .select()
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.organizationId, orgId),
          eq(notificationEmailQueue.userId, userId),
          dueForCadence(cadence, now),
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
          inArray(notificationEmailQueue.status, [...SENDABLE]),
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
          inArray(notificationEmailQueue.status, [...SENDABLE]),
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
          inArray(notificationEmailQueue.status, [...SENDABLE]),
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
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
  },

  /**
   * ADR 0046 r.6. Returns the rows it actually moved so the caller can cascade
   * a bounce onto the recipient's other queued mail; an empty array means the
   * event was unknown or out of order, which the webhook logs rather than
   * silently discards.
   */
  recordProviderState: async (
    providerMessageId: string,
    state: 'delivered' | 'bounced' | 'complained',
    occurredAt: Date,
  ): Promise<readonly ProviderStateTransition[]> => {
    const rows = await db
      .update(notificationEmailQueue)
      .set({
        status: state,
        providerState: state,
        ...(state === 'delivered'
          ? { deliveredAt: occurredAt }
          : { bouncedAt: occurredAt }),
        updatedAt: occurredAt,
      })
      .where(
        and(
          eq(notificationEmailQueue.providerMessageId, providerMessageId),
          inArray(notificationEmailQueue.status, [...PROVIDER_STATE_PREDECESSORS[state]]),
        ),
      )
      .returning({
        id: notificationEmailQueue.id,
        userId: notificationEmailQueue.userId,
        organizationId: notificationEmailQueue.organizationId,
        propertyId: notificationEmailQueue.propertyId,
      })
    return rows.map((row) => ({
      emailId: notificationEmailId(row.id),
      userId: toUserId(row.userId),
      organizationId: toOrgId(row.organizationId),
      propertyId: toPropertyId(row.propertyId),
    }))
  },

  /**
   * A dead address stays dead: once the provider reports a bounce or a
   * complaint, every still-sendable row this recipient has in the org is
   * suppressed rather than left to be attempted and rejected one by one.
   */
  suppressRecipient: async (
    userId: string,
    orgId: string,
    reason: string,
    updatedAt: Date,
  ): Promise<number> => {
    const rows = await db
      .update(notificationEmailQueue)
      .set({
        status: 'suppressed',
        providerState: 'suppressed',
        suppressionReason: reason,
        nextAttemptAt: null,
        updatedAt,
      })
      .where(
        and(
          eq(notificationEmailQueue.userId, userId),
          eq(notificationEmailQueue.organizationId, orgId),
          inArray(notificationEmailQueue.status, [...SENDABLE]),
        ),
      )
      .returning({ id: notificationEmailQueue.id })
    return rows.length
  },

  isRecipientSuppressed: async (userId: string, orgId: string): Promise<boolean> => {
    const rows = await db
      .select({ id: notificationEmailQueue.id })
      .from(notificationEmailQueue)
      .where(
        and(
          eq(notificationEmailQueue.userId, userId),
          eq(notificationEmailQueue.organizationId, orgId),
          inArray(notificationEmailQueue.providerState, ['bounced', 'complained']),
        ),
      )
      .limit(1)
    return rows.length > 0
  },
})
