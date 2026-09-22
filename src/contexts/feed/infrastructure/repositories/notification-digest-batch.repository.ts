// Feed notification surface — the daily digest's immutable batches: one
// provider idempotency key per frozen set of queue rows (ADR 0046 r.5).
// Composed into the email repository.

import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  notificationDigestBatchMembers,
  notificationDigestBatches,
  notificationEmailQueue,
} from '#/shared/db/schema/notification.schema'
import {
  notificationDigestBatchId,
  organizationId as toOrgId,
  userId as toUserId,
} from '#/shared/domain/ids'
import type { NotificationEmail } from '../../domain/notification-types'
import type {
  DigestBatchSettlement,
  NotificationDigestBatch,
  PreparedNotificationDigestBatch,
} from '../../application/ports/notification-email-repository.port'
import { digestBatchIdempotencyKey, digestMemberSet } from '../digest-batch-identity'
import { digestUnsubscribeScopesInsert } from './notification-unsubscribe-scope.repository'
import { emailFromRow, firstAttemptAt, SENDABLE } from './notification-email-queue-rows'
import { notificationError } from '../../domain/notification-errors'

type DigestBatchRow = typeof notificationDigestBatches.$inferSelect

/**
 * `outcome_class` of a retryable batch the provider refused on EVERY attempt,
 * before accepting anything. Only such a batch may be re-keyed: its key
 * protects no delivered mail.
 */
const REFUSED_OUTCOME_CLASS = 'refused'

/**
 * `outcome_class` of an attempt recorded as started, while every earlier
 * attempt was refused. The settlement turns it into `refused` only when the
 * provider refused this attempt too; a worker that dies mid-call leaves it
 * here, and the next start reads it as possibly accepted.
 */
const IN_FLIGHT_OUTCOME_CLASS = 'in_flight'

/**
 * `outcome_class` once any attempt may have been accepted — a 5xx, a timeout,
 * a lost answer or a lost worker. Sticky: a later refusal cannot clear it.
 */
const POSSIBLY_ACCEPTED_OUTCOME_CLASS = 'transient'

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
  everyAttemptRefused:
    row.state === 'retryable' && row.outcomeClass === REFUSED_OUTCOME_CLASS,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const createNotificationDigestBatchStore = (db: Database) => ({
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
    const expectedMemberDigest = digestMemberSet(input.memberIds)
    if (input.memberDigest !== expectedMemberDigest) {
      throw notificationError(
        'insert_failed',
        'Digest batch member fingerprint does not match exact members',
      )
    }
    const expectedProviderIdempotencyKey = digestBatchIdempotencyKey({
      organizationId: input.organizationId,
      userId: input.userId,
      localDate: input.localDate,
      batchId: input.id,
      memberDigest: expectedMemberDigest,
    })
    if (input.providerIdempotencyKey !== expectedProviderIdempotencyKey) {
      throw notificationError(
        'insert_failed',
        'Digest batch provider key does not match immutable identity',
      )
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
      // The batch's unsubscribe link must outlive the rows retention deletes.
      await tx.execute(
        digestUnsubscribeScopesInsert({
          batchId: input.id,
          organizationId: input.organizationId,
          userId: input.userId,
          memberIds: input.memberIds,
          recordedAt: input.preparedAt,
        }),
      )
      return { batch: digestBatchFromRow(row), created: true }
    })
  },

  startDigestAttempt: async (input: {
    batchId: string
    organizationId: string
    userId: string
    startedAt: Date
  }): Promise<boolean> => {
    const rows = await db
      .update(notificationDigestBatches)
      .set({
        outcomeClass: sql`CASE
          WHEN ${notificationDigestBatches.outcomeClass} IS NULL
            OR ${notificationDigestBatches.outcomeClass} = ${REFUSED_OUTCOME_CLASS}
          THEN ${IN_FLIGHT_OUTCOME_CLASS}
          ELSE ${POSSIBLY_ACCEPTED_OUTCOME_CLASS}
        END`,
        attemptedAt: input.startedAt,
        updatedAt: input.startedAt,
      })
      .where(
        and(
          eq(notificationDigestBatches.id, input.batchId),
          eq(notificationDigestBatches.organizationId, input.organizationId),
          eq(notificationDigestBatches.userId, input.userId),
          inArray(notificationDigestBatches.state, ['prepared', 'retryable']),
        ),
      )
      .returning({ id: notificationDigestBatches.id })
    return rows.length > 0
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
      const { kind } = input.settlement
      // A provider outcome belongs to the exact content that was frozen; a
      // content mismatch must really be one.
      if ((kind === 'accepted' || kind === 'rejected') && mismatch) return false
      if (kind === 'content_mismatch' && !mismatch) return false
      // Re-keying a batch the provider may have accepted could mail it twice.
      // A refused batch may be retired whatever changed: its content, or the
      // members that are still deliverable.
      if (kind === 'superseded' && !digestBatchFromRow(batch).everyAttemptRefused) {
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
      const memberIds = members.map((member) => member.id)
      const immutableMembershipIntact =
        members.length > 0 && digestMemberSet(memberIds) === batch.memberDigest
      // An accepted/rejected provider outcome is meaningful only for the
      // exact frozen set. Invalidation is the recovery path for corrupted or
      // unavailable membership and must still be able to close an empty batch.
      if (!immutableMembershipIntact && input.settlement.kind !== 'invalidated') {
        return false
      }

      if (input.settlement.kind === 'accepted') {
        await tx
          .update(notificationEmailQueue)
          .set({
            status: 'accepted',
            providerMessageId: input.settlement.providerMessageId,
            providerState: 'accepted',
            acceptedAt: input.settlement.acceptedAt,
            sentAt: input.settlement.acceptedAt,
            attemptedAt: firstAttemptAt(input.settlement.acceptedAt),
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

      if (input.settlement.kind === 'superseded') {
        // The members stay sendable and leave the frozen set, so a fresh
        // batch can take them; a queue row belongs to one batch at a time.
        await tx
          .delete(notificationDigestBatchMembers)
          .where(
            and(
              eq(notificationDigestBatchMembers.batchId, input.batchId),
              eq(notificationDigestBatchMembers.organizationId, input.organizationId),
              eq(notificationDigestBatchMembers.userId, input.userId),
            ),
          )
        await tx
          .update(notificationDigestBatches)
          .set({
            state: 'terminal',
            outcomeClass: 'superseded',
            terminalReason: 'provider_request_changed',
            updatedAt: input.settlement.detectedAt,
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
        if (memberIds.length > 0) {
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
        }
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
          attemptedAt: firstAttemptAt(input.settlement.failedAt),
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
          // Refused only when this attempt was refused AND every earlier
          // one was: the start of this attempt left `in_flight` only then.
          outcomeClass:
            retryable &&
            input.settlement.refusedBeforeAcceptance &&
            batch.outcomeClass === IN_FLIGHT_OUTCOME_CLASS
              ? REFUSED_OUTCOME_CLASS
              : input.settlement.classification,
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
