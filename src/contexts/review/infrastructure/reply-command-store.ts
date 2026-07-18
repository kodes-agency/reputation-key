// Atomic reply command store (BQC-3.3).
//
// One PostgreSQL transaction: reply/review state mutation + outbox_events
// insert. After commit: in-process EventBus emit for expand-phase legacy
// consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back BOTH the state mutation
//   and the outbox row — no state/outbox split is ever observable.
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).
// - A guarded transition that matches no row (lost TOCTOU race) records no
//   outbox row and emits nothing — the caller sees null, exactly as with
//   ReplyRepository.conditionalUpdate today.

import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { replies, reviews } from '#/shared/db/schema/review.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import type { Reply } from '../domain/types'
import { reviewError } from '../domain/errors'
import { replyFromRow, replyToRow } from './mappers/reply.mapper'
import { buildReplySetClause } from './reply-set-clause'
import type {
  ConditionalReplyUpdate,
  ReplyRepository,
} from '../application/ports/reply.repository'
import type { ReplyCommandStore } from '../application/ports/reply-command-store.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  // Expand-phase dual path: durable outbox already committed. Bus failure must
  // not roll back or hide the durable fact (relay will deliver when enabled).
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.3: in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

/**
 * Guarded reply update inside a transaction. Applies only while the row's
 * status is still the one the use case read (`reply.status`) — identical
 * TOCTOU semantics to ReplyRepository.conditionalUpdate.
 */
async function guardedReplyUpdate(
  tx: Tx,
  reply: Reply,
  updates: ConditionalReplyUpdate,
  now: Date | undefined,
): Promise<Reply | null> {
  const result = await tx
    .update(replies)
    .set(buildReplySetClause(updates, now ?? new Date()))
    .where(
      and(
        eq(replies.id, reply.id),
        eq(replies.organizationId, reply.organizationId),
        inArray(replies.status, [reply.status]),
      ),
    )
    .returning()
  // No row matched → status changed concurrently, TOCTOU guard triggered.
  return result[0] ? replyFromRow(result[0]) : null
}

async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}

export function createAtomicReplyCommandStore(
  db: Database,
  events: EventBus,
): ReplyCommandStore {
  /** Shared runner for the guarded-transition commands. */
  const transition = async (
    span: string,
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    return trace(span, async () => {
      const saved = await db.transaction(async (tx) => {
        const row = await guardedReplyUpdate(tx, reply, updates, now)
        if (!row) return null
        if (event) await insertOutboxRow(tx, event)
        return row
      })
      if (saved && event) await emitAfterCommit(events, event)
      return saved
    })
  }

  const mirrorUpsert = async (
    tx: Tx,
    replyToUpsert: Omit<Reply, 'createdAt' | 'updatedAt'>,
    now?: Date,
  ) => {
    const row = replyToRow(replyToUpsert)
    const result = await tx
      .insert(replies)
      .values(row)
      .onConflictDoUpdate({
        target: [replies.reviewId, replies.source, replies.organizationId],
        set: {
          text: row.text,
          status: row.status,
          approvedBy: row.approvedBy,
          rejectedBy: row.rejectedBy,
          rejectionReason: row.rejectionReason,
          aiGenerated: row.aiGenerated,
          submittedAt: row.submittedAt,
          approvedAt: row.approvedAt,
          publishedAt: row.publishedAt,
          updatedAt: now ?? new Date(),
        },
      })
      .returning()
    if (!result[0]) {
      throw reviewError(
        'repo_upsert_failed',
        'Reply mirror upsert failed — no row returned',
      )
    }
    return replyFromRow(result[0])
  }

  return {
    submitReply: (reply, updates, event, now) =>
      transition('reply.commandStore.submitReply', reply, updates, event, now),
    approveReply: (reply, updates, event, now) =>
      transition('reply.commandStore.approveReply', reply, updates, event, now),
    rejectReply: (reply, updates, event, now) =>
      transition('reply.commandStore.rejectReply', reply, updates, event, now),
    markPublished: (reply, updates, event, now) =>
      transition('reply.commandStore.markPublished', reply, updates, event, now),
    markPublishFailed: (reply, updates, event, now) =>
      transition('reply.commandStore.markPublishFailed', reply, updates, event, now),

    mirrorSyncedReply: async (command) => {
      return trace('reply.commandStore.mirrorSyncedReply', async () => {
        const saved = await db.transaction(async (tx) => {
          if (!command.reply) {
            // Google no longer shows a reply — remove the mirror. No fact.
            await tx
              .delete(replies)
              .where(
                and(
                  eq(replies.reviewId, command.reviewId),
                  eq(replies.source, 'google_sync'),
                  eq(replies.organizationId, command.organizationId),
                ),
              )
            return null
          }
          const mirrored = await mirrorUpsert(tx, command.reply, command.now)
          if (command.event) await insertOutboxRow(tx, command.event)
          return mirrored
        })
        if (saved && command.event) await emitAfterCommit(events, command.event)
        return saved
      })
    },

    purgeExpiredReview: async (reviewId, event) => {
      return trace('reply.commandStore.purgeExpiredReview', async () => {
        await db.transaction(async (tx) => {
          // Delete + fact commit together: a crash removes neither or both.
          await tx
            .delete(reviews)
            .where(
              and(
                eq(reviews.id, reviewId),
                eq(reviews.organizationId, event.organizationId),
              ),
            )
          await insertOutboxRow(tx, event)
        })
        await emitAfterCommit(events, event)
      })
    },
  }
}

/**
 * Non-transactional store for unit tests / expand-phase fakes.
 * Applies the same operation order (state → outbox → emit) without a real
 * transaction. Not for production — production must use
 * createAtomicReplyCommandStore.
 */
export function createSequentialReplyCommandStore(deps: {
  conditionalUpdate: ReplyRepository['conditionalUpdate']
  upsert: ReplyRepository['upsert']
  deleteByReviewIdAndSource: ReplyRepository['deleteByReviewIdAndSource']
  deleteReviewById: (reviewId: ReviewId, organizationId: OrganizationId) => Promise<void>
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
}): ReplyCommandStore {
  const recordAndEmit = async (event: DomainEvent): Promise<void> => {
    if (deps.recordOutbox) await deps.recordOutbox(event)
    await emitAfterCommit(deps.events, event)
  }

  const transition = async (
    reply: Reply,
    updates: ConditionalReplyUpdate,
    event: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    const saved = await deps.conditionalUpdate(
      reply.id,
      reply.organizationId,
      [reply.status],
      updates,
      now,
    )
    if (saved && event) await recordAndEmit(event)
    return saved
  }

  return {
    submitReply: (reply, updates, event, now) => transition(reply, updates, event, now),
    approveReply: (reply, updates, event, now) => transition(reply, updates, event, now),
    rejectReply: (reply, updates, event, now) => transition(reply, updates, event, now),
    markPublished: (reply, updates, event, now) => transition(reply, updates, event, now),
    markPublishFailed: (reply, updates, event, now) =>
      transition(reply, updates, event, now),

    mirrorSyncedReply: async (command) => {
      if (!command.reply) {
        await deps.deleteByReviewIdAndSource(
          command.reviewId,
          'google_sync',
          command.organizationId,
        )
        return null
      }
      const saved = await deps.upsert(command.reply, command.now)
      if (command.event) await recordAndEmit(command.event)
      return saved
    },

    purgeExpiredReview: async (reviewId, event) => {
      await deps.deleteReviewById(reviewId, event.organizationId)
      await recordAndEmit(event)
    },
  }
}
