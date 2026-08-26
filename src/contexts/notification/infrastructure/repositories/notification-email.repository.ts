// Notification context — Drizzle repository adapter for notification email queue
// Per architecture: factory pattern `createXxxRepository(db)` returning port interface.

import { and, asc, eq, inArray, lte, max, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatchMembers,
  notificationDigestBatches,
  notificationEmailQueue,
} from '#/shared/db/schema/notification.schema'
import {
  notificationDigestBatchId,
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
  DigestBatchSettlement,
  NotificationDigestBatch,
  NotificationEmailRecipient,
  PreparedNotificationDigestBatch,
  ProviderStateTransition,
} from '../../application/ports/notification-email-repository.port'
import { notificationError } from '../../domain/errors'

type EmailRow = typeof notificationEmailQueue.$inferSelect
type DigestBatchRow = typeof notificationDigestBatches.$inferSelect

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

const digestBatchFromRow = (row: DigestBatchRow): NotificationDigestBatch => ({
  id: notificationDigestBatchId(row.id),
  organizationId: toOrgId(row.organizationId),
  userId: toUserId(row.userId),
  localDate: row.localDate,
  sequence: row.sequence,
  memberDigest: row.memberDigest,
  contentDigest: row.contentDigest,
  providerIdempotencyKey: row.providerIdempotencyKey,
  unsubscribeKeyVersion: row.unsubscribeKeyVersion,
  state: row.state as NotificationDigestBatch['state'],
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
        and(
          eq(notificationEmailQueue.lastErrorClass, 'transient'),
          sql`${notificationEmailQueue.retryCount} < 5`,
        ),
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
    const [rows, openBatches] = await Promise.all([
      db
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
        .limit(5_000),
      cadence === 'daily'
        ? db
            .selectDistinct({
              organizationId: notificationDigestBatches.organizationId,
              userId: notificationDigestBatches.userId,
            })
            .from(notificationDigestBatches)
            .where(inArray(notificationDigestBatches.state, ['prepared', 'retryable']))
            .orderBy(
              asc(notificationDigestBatches.organizationId),
              asc(notificationDigestBatches.userId),
            )
            .limit(5_000)
        : Promise.resolve([]),
    ])
    const recipients = new Map<string, NotificationEmailRecipient>()
    // Recover already-owned provider attempts before opening new work when a
    // large backlog reaches the sweep cap.
    for (const row of [...openBatches, ...rows]) {
      recipients.set(`${row.organizationId}\0${row.userId}`, {
        organizationId: toOrgId(row.organizationId),
        userId: toUserId(row.userId),
      })
    }
    return [...recipients.values()].slice(0, 5_000)
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

  findOpenDigestBatch: async (
    orgId: string,
    userId: string,
  ): Promise<NotificationDigestBatch | null> => {
    const rows = await db
      .select()
      .from(notificationDigestBatches)
      .where(
        and(
          eq(notificationDigestBatches.organizationId, orgId),
          eq(notificationDigestBatches.userId, userId),
          inArray(notificationDigestBatches.state, ['prepared', 'retryable']),
        ),
      )
      .limit(1)
    return rows[0] ? digestBatchFromRow(rows[0]) : null
  },

  findDigestBatchEntries: async (
    batchId: string,
    orgId: string,
    userId: string,
  ): Promise<readonly NotificationEmail[]> => {
    const rows = await db
      .select({ email: notificationEmailQueue })
      .from(notificationDigestBatchMembers)
      .innerJoin(
        notificationEmailQueue,
        and(
          eq(
            notificationEmailQueue.id,
            notificationDigestBatchMembers.notificationEmailId,
          ),
          eq(
            notificationEmailQueue.organizationId,
            notificationDigestBatchMembers.organizationId,
          ),
          eq(notificationEmailQueue.userId, notificationDigestBatchMembers.userId),
        ),
      )
      .where(
        and(
          eq(notificationDigestBatchMembers.batchId, batchId),
          eq(notificationDigestBatchMembers.organizationId, orgId),
          eq(notificationDigestBatchMembers.userId, userId),
        ),
      )
      .orderBy(asc(notificationDigestBatchMembers.sortIndex))
    return rows.map((row) => emailFromRow(row.email))
  },

  prepareDigestBatch: async (input: {
    id: string
    organizationId: string
    userId: string
    localDate: string
    memberIds: readonly string[]
    memberDigest: string
    contentDigest: string
    providerIdempotencyKey: string
    unsubscribeKeyVersion: string
    preparedAt: Date
  }): Promise<PreparedNotificationDigestBatch> => {
    if (input.memberIds.length === 0) {
      throw notificationError(
        'insert_failed',
        'Digest batch requires at least one member',
      )
    }
    if (new Set(input.memberIds).size !== input.memberIds.length) {
      throw notificationError('insert_failed', 'Digest batch members must be unique')
    }

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-digest:${input.organizationId}:${input.userId}`}, 0))`,
      )

      const existing = await tx
        .select()
        .from(notificationDigestBatches)
        .where(
          and(
            eq(notificationDigestBatches.organizationId, input.organizationId),
            eq(notificationDigestBatches.userId, input.userId),
            inArray(notificationDigestBatches.state, ['prepared', 'retryable']),
          ),
        )
        .limit(1)
      if (existing[0]) {
        return { batch: digestBatchFromRow(existing[0]), created: false }
      }

      const eligible = await tx
        .select({ id: notificationEmailQueue.id })
        .from(notificationEmailQueue)
        .where(
          and(
            eq(notificationEmailQueue.organizationId, input.organizationId),
            eq(notificationEmailQueue.userId, input.userId),
            eq(notificationEmailQueue.cadence, 'daily'),
            inArray(notificationEmailQueue.status, [...SENDABLE]),
            inArray(notificationEmailQueue.id, [...input.memberIds]),
          ),
        )
        .for('update')
      if (eligible.length !== input.memberIds.length) {
        throw notificationError(
          'insert_failed',
          'Digest batch membership changed before preparation',
        )
      }

      const sequences = await tx
        .select({ value: max(notificationDigestBatches.sequence) })
        .from(notificationDigestBatches)
        .where(
          and(
            eq(notificationDigestBatches.organizationId, input.organizationId),
            eq(notificationDigestBatches.userId, input.userId),
            eq(notificationDigestBatches.localDate, input.localDate),
          ),
        )
      const sequence = (sequences[0]?.value ?? 0) + 1
      const rows = await tx
        .insert(notificationDigestBatches)
        .values({
          id: input.id,
          organizationId: input.organizationId,
          userId: input.userId,
          localDate: input.localDate,
          sequence,
          memberDigest: input.memberDigest,
          contentDigest: input.contentDigest,
          providerIdempotencyKey: input.providerIdempotencyKey,
          unsubscribeKeyVersion: input.unsubscribeKeyVersion,
          state: 'prepared',
          createdAt: input.preparedAt,
          updatedAt: input.preparedAt,
        })
        .returning()
      const row = rows[0]
      if (!row) throw notificationError('insert_failed', 'Digest batch INSERT failed')

      await tx.insert(notificationDigestBatchMembers).values(
        input.memberIds.map((memberId, sortIndex) => ({
          batchId: input.id,
          organizationId: input.organizationId,
          userId: input.userId,
          notificationEmailId: memberId,
          sortIndex,
          createdAt: input.preparedAt,
        })),
      )
      return { batch: digestBatchFromRow(row), created: true }
    })
  },

  settleDigestBatch: async (input: {
    batchId: string
    organizationId: string
    userId: string
    expectedContentDigest: string
    settlement: DigestBatchSettlement
  }): Promise<boolean> =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-digest:${input.organizationId}:${input.userId}`}, 0))`,
      )
      const rows = await tx
        .select()
        .from(notificationDigestBatches)
        .where(
          and(
            eq(notificationDigestBatches.id, input.batchId),
            eq(notificationDigestBatches.organizationId, input.organizationId),
            eq(notificationDigestBatches.userId, input.userId),
            inArray(notificationDigestBatches.state, ['prepared', 'retryable']),
          ),
        )
        .limit(1)
        .for('update')
      const batch = rows[0]
      if (!batch) return false
      const mismatch = batch.contentDigest !== input.expectedContentDigest
      if (
        (input.settlement.kind === 'content_mismatch' && !mismatch) ||
        (input.settlement.kind !== 'content_mismatch' &&
          input.settlement.kind !== 'invalidated' &&
          mismatch)
      ) {
        return false
      }

      const members = await tx
        .select({ id: notificationDigestBatchMembers.notificationEmailId })
        .from(notificationDigestBatchMembers)
        .where(
          and(
            eq(notificationDigestBatchMembers.batchId, input.batchId),
            eq(notificationDigestBatchMembers.organizationId, input.organizationId),
            eq(notificationDigestBatchMembers.userId, input.userId),
          ),
        )
      if (members.length === 0) return false
      const memberIds = members.map((member) => member.id)

      if (input.settlement.kind === 'accepted') {
        await tx
          .update(notificationEmailQueue)
          .set({
            status: 'accepted',
            providerMessageId: input.settlement.providerMessageId,
            providerState: 'accepted',
            acceptedAt: input.settlement.acceptedAt,
            sentAt: input.settlement.acceptedAt,
            attemptedAt: input.settlement.acceptedAt,
            lastErrorClass: null,
            nextAttemptAt: null,
            updatedAt: input.settlement.acceptedAt,
          })
          .where(
            and(
              eq(notificationEmailQueue.organizationId, input.organizationId),
              eq(notificationEmailQueue.userId, input.userId),
              inArray(notificationEmailQueue.id, memberIds),
              inArray(notificationEmailQueue.status, [...SENDABLE]),
            ),
          )
        await tx
          .update(notificationDigestBatches)
          .set({
            state: 'accepted',
            providerMessageId: input.settlement.providerMessageId,
            outcomeClass: null,
            terminalReason: null,
            attemptedAt: input.settlement.acceptedAt,
            acceptedAt: input.settlement.acceptedAt,
            updatedAt: input.settlement.acceptedAt,
          })
          .where(eq(notificationDigestBatches.id, input.batchId))
        return true
      }

      if (input.settlement.kind === 'content_mismatch') {
        await tx
          .update(notificationEmailQueue)
          .set({
            status: 'suppressed',
            providerState: 'suppressed',
            suppressionReason: 'digest_content_changed',
            nextAttemptAt: null,
            updatedAt: input.settlement.detectedAt,
          })
          .where(
            and(
              eq(notificationEmailQueue.organizationId, input.organizationId),
              eq(notificationEmailQueue.userId, input.userId),
              inArray(notificationEmailQueue.id, memberIds),
              inArray(notificationEmailQueue.status, [...SENDABLE]),
            ),
          )
        await tx
          .update(notificationDigestBatches)
          .set({
            state: 'terminal',
            outcomeClass: 'content_mismatch',
            terminalReason: 'provider_request_changed',
            failedAt: input.settlement.detectedAt,
            updatedAt: input.settlement.detectedAt,
          })
          .where(eq(notificationDigestBatches.id, input.batchId))
        return true
      }

      if (input.settlement.kind === 'invalidated') {
        await tx
          .update(notificationEmailQueue)
          .set({
            status: 'suppressed',
            providerState: 'suppressed',
            suppressionReason: input.settlement.reason,
            nextAttemptAt: null,
            updatedAt: input.settlement.invalidatedAt,
          })
          .where(
            and(
              eq(notificationEmailQueue.organizationId, input.organizationId),
              eq(notificationEmailQueue.userId, input.userId),
              inArray(notificationEmailQueue.id, memberIds),
              inArray(notificationEmailQueue.status, [...SENDABLE]),
            ),
          )
        await tx
          .update(notificationDigestBatches)
          .set({
            state: 'terminal',
            outcomeClass: 'invalidated',
            terminalReason: input.settlement.reason,
            failedAt: input.settlement.invalidatedAt,
            updatedAt: input.settlement.invalidatedAt,
          })
          .where(eq(notificationDigestBatches.id, input.batchId))
        return true
      }

      const retryable = input.settlement.classification === 'transient'
      await tx
        .update(notificationEmailQueue)
        .set({
          status:
            input.settlement.classification === 'suppressed' ? 'suppressed' : 'failed',
          lastErrorClass: input.settlement.classification,
          failedAt: input.settlement.failedAt,
          attemptedAt: input.settlement.failedAt,
          nextAttemptAt: input.settlement.nextAttemptAt,
          retryCount: sql`${notificationEmailQueue.retryCount} + 1`,
          updatedAt: input.settlement.failedAt,
        })
        .where(
          and(
            eq(notificationEmailQueue.organizationId, input.organizationId),
            eq(notificationEmailQueue.userId, input.userId),
            inArray(notificationEmailQueue.id, memberIds),
            inArray(notificationEmailQueue.status, [...SENDABLE]),
          ),
        )
      await tx
        .update(notificationDigestBatches)
        .set({
          state: retryable ? 'retryable' : 'terminal',
          outcomeClass: input.settlement.classification,
          terminalReason: retryable ? null : 'provider_rejected',
          retryCount: sql`${notificationDigestBatches.retryCount} + 1`,
          attemptedAt: input.settlement.failedAt,
          failedAt: input.settlement.failedAt,
          updatedAt: input.settlement.failedAt,
        })
        .where(eq(notificationDigestBatches.id, input.batchId))
      return true
    }),
})
