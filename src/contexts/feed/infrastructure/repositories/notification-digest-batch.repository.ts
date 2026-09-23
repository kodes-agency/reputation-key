// Feed notification surface — the daily digest's immutable batches: one
// provider idempotency key per frozen set of queue rows (ADR 0046 r.5).
// Composed into the email repository.

import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import type { Tx } from '#/shared/outbox/commit'
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

type SettleDigestBatchInput = Readonly<{
  batchId: string
  organizationId: string
  userId: string
  expectedContentDigest: string
  settlement: DigestBatchSettlement
}>

type BatchScope = Readonly<{ batchId: string; organizationId: string; userId: string }>

/** A batch's frozen members, as a settlement moves them. */
type FrozenMembers = BatchScope & Readonly<{ memberIds: string[] }>

type Settling<K extends DigestBatchSettlement['kind']> = Extract<
  DigestBatchSettlement,
  Readonly<{ kind: K }>
>

/** Serializes every change to one recipient's digest batches. */
const digestLock = (organizationId: string, userId: string) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notification-digest:${organizationId}:${userId}`}, 0))`

/** The batch's frozen member rows. */
const batchMembersWhere = (scope: BatchScope) =>
  and(
    eq(notificationDigestBatchMembers.batchId, scope.batchId),
    eq(notificationDigestBatchMembers.organizationId, scope.organizationId),
    eq(notificationDigestBatchMembers.userId, scope.userId),
  )

/** The frozen members a settlement still moves: those not settled elsewhere. */
const sendableMembersWhere = (frozen: FrozenMembers) =>
  and(
    eq(notificationEmailQueue.organizationId, frozen.organizationId),
    eq(notificationEmailQueue.userId, frozen.userId),
    inArray(notificationEmailQueue.id, frozen.memberIds),
    inArray(notificationEmailQueue.status, [...SENDABLE]),
  )

/** Whether this settlement may close this batch at all. */
function settlementFitsBatch(
  batch: DigestBatchRow,
  input: SettleDigestBatchInput,
): boolean {
  const mismatch = batch.contentDigest !== input.expectedContentDigest
  const { kind } = input.settlement
  // A provider outcome belongs to the exact content that was frozen; a
  // content mismatch must really be one.
  if ((kind === 'accepted' || kind === 'rejected') && mismatch) return false
  if (kind === 'content_mismatch' && !mismatch) return false
  // Re-keying a batch the provider may have accepted could mail it twice.
  // A refused batch may be retired whatever changed: its content, or the
  // members that are still deliverable.
  return kind !== 'superseded' || digestBatchFromRow(batch).everyAttemptRefused
}

async function settleAccepted(
  tx: Tx,
  frozen: FrozenMembers,
  settlement: Settling<'accepted'>,
): Promise<void> {
  await tx
    .update(notificationEmailQueue)
    .set({
      status: 'accepted',
      providerMessageId: settlement.providerMessageId,
      providerState: 'accepted',
      acceptedAt: settlement.acceptedAt,
      sentAt: settlement.acceptedAt,
      attemptedAt: firstAttemptAt(settlement.acceptedAt),
      lastErrorClass: null,
      nextAttemptAt: null,
      updatedAt: settlement.acceptedAt,
    })
    .where(sendableMembersWhere(frozen))
  await tx
    .update(notificationDigestBatches)
    .set({
      state: 'accepted',
      providerMessageId: settlement.providerMessageId,
      outcomeClass: null,
      terminalReason: null,
      attemptedAt: settlement.acceptedAt,
      acceptedAt: settlement.acceptedAt,
      updatedAt: settlement.acceptedAt,
    })
    .where(eq(notificationDigestBatches.id, frozen.batchId))
}

async function settleSuperseded(
  tx: Tx,
  frozen: FrozenMembers,
  settlement: Settling<'superseded'>,
): Promise<void> {
  // The members stay sendable and leave the frozen set, so a fresh
  // batch can take them; a queue row belongs to one batch at a time.
  await tx.delete(notificationDigestBatchMembers).where(batchMembersWhere(frozen))
  await tx
    .update(notificationDigestBatches)
    .set({
      state: 'terminal',
      outcomeClass: 'superseded',
      terminalReason: 'provider_request_changed',
      updatedAt: settlement.detectedAt,
    })
    .where(eq(notificationDigestBatches.id, frozen.batchId))
}

/**
 * Suppress the members still sendable and close the batch for good. An
 * invalidated batch may have lost its membership: then nothing is suppressed.
 */
async function suppressAndClose(
  tx: Tx,
  frozen: FrozenMembers,
  closure: Readonly<{
    outcomeClass: 'content_mismatch' | 'invalidated'
    suppressionReason: string
    terminalReason: string
    at: Date
  }>,
): Promise<void> {
  if (frozen.memberIds.length > 0) {
    await tx
      .update(notificationEmailQueue)
      .set({
        status: 'suppressed',
        providerState: 'suppressed',
        suppressionReason: closure.suppressionReason,
        nextAttemptAt: null,
        updatedAt: closure.at,
      })
      .where(sendableMembersWhere(frozen))
  }
  await tx
    .update(notificationDigestBatches)
    .set({
      state: 'terminal',
      outcomeClass: closure.outcomeClass,
      terminalReason: closure.terminalReason,
      failedAt: closure.at,
      updatedAt: closure.at,
    })
    .where(eq(notificationDigestBatches.id, frozen.batchId))
}

async function settleRejected(
  tx: Tx,
  frozen: FrozenMembers,
  settlement: Settling<'rejected'>,
  previousOutcomeClass: string | null,
): Promise<void> {
  const retryable = settlement.classification === 'transient'
  await tx
    .update(notificationEmailQueue)
    .set({
      status: settlement.classification === 'suppressed' ? 'suppressed' : 'failed',
      lastErrorClass: settlement.classification,
      failedAt: settlement.failedAt,
      attemptedAt: firstAttemptAt(settlement.failedAt),
      nextAttemptAt: settlement.nextAttemptAt,
      retryCount: sql`${notificationEmailQueue.retryCount} + 1`,
      updatedAt: settlement.failedAt,
    })
    .where(sendableMembersWhere(frozen))
  await tx
    .update(notificationDigestBatches)
    .set({
      state: retryable ? 'retryable' : 'terminal',
      // Refused only when this attempt was refused AND every earlier
      // one was: the start of this attempt left `in_flight` only then.
      outcomeClass:
        retryable &&
        settlement.refusedBeforeAcceptance &&
        previousOutcomeClass === IN_FLIGHT_OUTCOME_CLASS
          ? REFUSED_OUTCOME_CLASS
          : settlement.classification,
      terminalReason: retryable ? null : 'provider_rejected',
      retryCount: sql`${notificationDigestBatches.retryCount} + 1`,
      attemptedAt: settlement.failedAt,
      failedAt: settlement.failedAt,
      updatedAt: settlement.failedAt,
    })
    .where(eq(notificationDigestBatches.id, frozen.batchId))
}

/** Write a settlement the batch and its membership were checked against. */
function applySettlement(
  tx: Tx,
  frozen: FrozenMembers & Readonly<{ settlement: DigestBatchSettlement }>,
  batch: DigestBatchRow,
): Promise<void> {
  const { settlement } = frozen
  switch (settlement.kind) {
    case 'accepted':
      return settleAccepted(tx, frozen, settlement)
    case 'superseded':
      return settleSuperseded(tx, frozen, settlement)
    case 'content_mismatch':
      return suppressAndClose(tx, frozen, {
        outcomeClass: 'content_mismatch',
        suppressionReason: 'digest_content_changed',
        terminalReason: 'provider_request_changed',
        at: settlement.detectedAt,
      })
    case 'invalidated':
      return suppressAndClose(tx, frozen, {
        outcomeClass: 'invalidated',
        suppressionReason: settlement.reason,
        terminalReason: settlement.reason,
        at: settlement.invalidatedAt,
      })
    case 'rejected':
      return settleRejected(tx, frozen, settlement, batch.outcomeClass)
  }
}

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
      await tx.execute(digestLock(input.organizationId, input.userId))

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

  settleDigestBatch: async (input: SettleDigestBatchInput): Promise<boolean> =>
    db.transaction(async (tx) => {
      await tx.execute(digestLock(input.organizationId, input.userId))
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
      if (!batch || !settlementFitsBatch(batch, input)) return false

      const members = await tx
        .select({ id: notificationDigestBatchMembers.notificationEmailId })
        .from(notificationDigestBatchMembers)
        .where(batchMembersWhere(input))
      const memberIds = members.map((member) => member.id)
      const immutableMembershipIntact =
        members.length > 0 && digestMemberSet(memberIds) === batch.memberDigest
      // An accepted/rejected provider outcome is meaningful only for the
      // exact frozen set. Invalidation is the recovery path for corrupted or
      // unavailable membership and must still be able to close an empty batch.
      if (!immutableMembershipIntact && input.settlement.kind !== 'invalidated') {
        return false
      }

      await applySettlement(tx, { ...input, memberIds }, batch)
      return true
    }),
})
