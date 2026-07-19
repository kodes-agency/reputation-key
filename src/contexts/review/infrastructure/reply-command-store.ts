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
//
// BQC-3.8: the publication state machine is persisted here. Publication
// transitions guard on BOTH status and publication_state; the target state
// comes from nextPublicationState (the domain authority), never from a
// caller-supplied literal.

import { and, eq, inArray, sql } from 'drizzle-orm'
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
import {
  AMBIGUOUS_RECONCILE_DELAY_MS,
  nextPublicationState,
  type PersistedPublicationState,
  type PublicationStateEvent,
} from '../domain/reply-publication-workflow'
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

/**
 * BQC-3.8: guarded publication update. Applies only while the row still has
 * the expected status AND one of `allowedStates` — the atomic backstop for
 * the cancellation race (a disconnect cancel moves the row out of every
 * publication-active state, so any racing publication write misses).
 */
async function guardedPublicationUpdate(
  run: Pick<Database, 'update'>,
  reply: Reply,
  expectedStatus: Reply['status'],
  allowedStates: ReadonlyArray<PersistedPublicationState>,
  set: Record<string, unknown>,
): Promise<Reply | null> {
  const result = await run
    .update(replies)
    .set(set)
    .where(
      and(
        eq(replies.id, reply.id),
        eq(replies.organizationId, reply.organizationId),
        eq(replies.status, expectedStatus),
        inArray(replies.publicationState, [...allowedStates]),
      ),
    )
    .returning()
  return result[0] ? replyFromRow(result[0]) : null
}

/**
 * Domain-authority pre-check on the read state (BQC-3.8). The SQL guard is
 * the real TOCTOU protection; this catches an impossible transition before
 * the write is even attempted. Returns the target state or null.
 */
function nextStateOrNull(
  reply: Reply,
  event: PublicationStateEvent,
): PersistedPublicationState | null {
  return nextPublicationState(reply.publicationState, event)
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

  /** BQC-3.8: guarded publication transition + optional fact, one tx. */
  const publicationTransition = async (
    span: string,
    reply: Reply,
    event: PublicationStateEvent,
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    set: (target: PersistedPublicationState, now: Date) => Record<string, unknown>,
    fact: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    return trace(span, async () => {
      const target = nextStateOrNull(reply, event)
      if (!target) return null
      const saved = await db.transaction(async (tx) => {
        const row = await guardedPublicationUpdate(
          tx,
          reply,
          reply.status,
          allowedStates,
          set(target, now ?? new Date()),
        )
        if (!row) return null
        if (fact) await insertOutboxRow(tx, fact)
        return row
      })
      if (saved && fact) await emitAfterCommit(events, fact)
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
          // BQC-3.8: publication columns are deliberately NOT in the conflict
          // set — a mirror refresh never clobbers an in-flight publication.
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
    rejectReply: (reply, updates, event, now) =>
      transition('reply.commandStore.rejectReply', reply, updates, event, now),
    // BQC-3.8: publish also persists publication_state='published' and clears
    // the reconcile schedule — provider confirmation is authoritative.
    markPublished: (reply, updates, event, now) =>
      transition(
        'reply.commandStore.markPublished',
        reply,
        { ...updates, publicationState: 'published', reconcileDueAt: null },
        event,
        now,
      ),

    // BQC-3.8: authorize = approve/retry re-authorization (new publication
    // cycle): guarded status update + authorized state + cycle reset + the
    // approved fact when one is supplied — one transaction.
    markPublicationAuthorized: (reply, updates, event, now) => {
      if (!nextStateOrNull(reply, 'authorize')) return Promise.resolve(null)
      return transition(
        'reply.commandStore.markPublicationAuthorized',
        reply,
        {
          ...updates,
          publicationState: 'authorized',
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        },
        event,
        now,
      )
    },

    // BQC-3.8: claim. No fact — the claim is internal bookkeeping. Single
    // guarded UPDATE (atomic by itself); null on a lost race.
    markPublicationSending: async (reply, now) => {
      return trace('reply.commandStore.markPublicationSending', async () => {
        const target = nextStateOrNull(reply, 'claim')
        if (!target) return null
        return guardedPublicationUpdate(
          db,
          reply,
          'approved',
          ['authorized', 'sending'],
          {
            publicationState: target,
            publicationAttempts: sql`${replies.publicationAttempts} + 1`,
            updatedAt: now ?? new Date(),
          },
        )
      })
    },

    markPublicationTerminal: (reply, errorClass, event, now) =>
      publicationTransition(
        'reply.commandStore.markPublicationTerminal',
        reply,
        'fail_terminal',
        ['sending'],
        (target, at) => ({
          status: 'publish_failed',
          publicationState: target,
          publicationLastErrorClass: errorClass,
          updatedAt: at,
        }),
        event,
        now,
      ),

    markPublicationAmbiguous: (reply, event, now) =>
      publicationTransition(
        'reply.commandStore.markPublicationAmbiguous',
        reply,
        'fail_ambiguous',
        ['sending'],
        (target, at) => ({
          status: 'publish_failed',
          publicationState: target,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date(at.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS),
          updatedAt: at,
        }),
        event,
        now,
      ),

    // BQC-3.8: retryable failure — back to 'authorized' (next attempt or
    // quarantine redrive re-claims); last_error_class/attempts preserved.
    markPublicationRetryQueued: async (reply, now) => {
      return trace('reply.commandStore.markPublicationRetryQueued', async () => {
        const target = nextStateOrNull(reply, 'requeue')
        if (!target) return null
        return guardedPublicationUpdate(db, reply, 'approved', ['sending'], {
          publicationState: target,
          updatedAt: now ?? new Date(),
        })
      })
    },

    // Edit-and-republish: guarded status='published' → 'approved' with the new
    // text + a fresh publication cycle + the review.reply.updated fact — one
    // transaction. The guard: the row must still be published (a purge,
    // cancellation, or concurrent edit since the user opened the editor loses
    // the race — no fact, no mutation, the caller surfaces invalid_transition).
    editPublishedReply: (reply, command) => {
      if (reply.status !== 'published') return Promise.resolve(null)
      return transition(
        'reply.commandStore.editPublishedReply',
        reply,
        {
          text: command.text,
          status: 'approved',
          publicationState: 'authorized',
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        },
        command.event,
        command.now,
      )
    },

    cancelPublications: async (commands) => {
      return trace('reply.commandStore.cancelPublications', async () => {
        if (commands.length === 0) return 0
        const committed: DomainEvent[] = []
        const cancelled = await db.transaction(async (tx) => {
          let count = 0
          for (const { reply, event, now } of commands) {
            // Rows whose state moved on (published/failed/cancelled/purged)
            // are skipped without a fact — the batch still commits.
            if (!nextStateOrNull(reply, 'cancel')) continue
            const row = await guardedPublicationUpdate(
              tx,
              reply,
              reply.status,
              ['requested', 'authorized', 'sending'],
              {
                status: 'draft',
                publicationState: 'cancelled',
                updatedAt: now ?? new Date(),
              },
            )
            if (!row) continue
            await insertOutboxRow(tx, event)
            committed.push(event)
            count++
          }
          return count
        })
        for (const event of committed) await emitAfterCommit(events, event)
        return cancelled
      })
    },

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
  /**
   * BQC-3.8: publication-state-guarded update for the claim/cancel/requeue
   * paths (the sequential equivalent of guardedPublicationUpdate).
   */
  publicationUpdate?: (
    reply: Reply,
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    updates: ConditionalReplyUpdate,
    now?: Date,
  ) => Promise<Reply | null>
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

  const publicationTransition = async (
    reply: Reply,
    event: PublicationStateEvent,
    allowedStates: ReadonlyArray<PersistedPublicationState>,
    updates: ConditionalReplyUpdate,
    fact: DomainEvent | null,
    now?: Date,
  ): Promise<Reply | null> => {
    if (!nextStateOrNull(reply, event)) return null
    if (!deps.publicationUpdate) {
      throw reviewError(
        'build_config_error',
        'publicationUpdate dep is required for publication transitions',
      )
    }
    const saved = await deps.publicationUpdate(reply, allowedStates, updates, now)
    if (saved && fact) await recordAndEmit(fact)
    return saved
  }

  return {
    submitReply: (reply, updates, event, now) => transition(reply, updates, event, now),
    rejectReply: (reply, updates, event, now) => transition(reply, updates, event, now),
    markPublished: (reply, updates, event, now) =>
      transition(
        reply,
        { ...updates, publicationState: 'published', reconcileDueAt: null },
        event,
        now,
      ),

    markPublicationAuthorized: (reply, updates, event, now) => {
      if (!nextStateOrNull(reply, 'authorize')) return Promise.resolve(null)
      return transition(
        reply,
        {
          ...updates,
          publicationState: 'authorized',
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        },
        event,
        now,
      )
    },

    markPublicationSending: (reply, now) =>
      publicationTransition(
        reply,
        'claim',
        ['authorized', 'sending'],
        { publicationState: 'sending' },
        null,
        now,
      ),

    markPublicationTerminal: (reply, errorClass, event, now) =>
      publicationTransition(
        reply,
        'fail_terminal',
        ['sending'],
        {
          status: 'publish_failed',
          publicationState: 'terminal',
          publicationLastErrorClass: errorClass,
        },
        event,
        now,
      ),

    markPublicationAmbiguous: (reply, event, now) =>
      publicationTransition(
        reply,
        'fail_ambiguous',
        ['sending'],
        {
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date(
            (now ?? new Date()).getTime() + AMBIGUOUS_RECONCILE_DELAY_MS,
          ),
        },
        event,
        now,
      ),

    markPublicationRetryQueued: (reply, now) =>
      publicationTransition(
        reply,
        'requeue',
        ['sending'],
        { publicationState: 'authorized' },
        null,
        now,
      ),

    // Edit-and-republish: guard on the persisted published status (mirrors the
    // atomic store — the fake's conditionalUpdate enforces the TOCTOU guard).
    editPublishedReply: (reply, command) => {
      if (reply.status !== 'published') return Promise.resolve(null)
      return transition(
        reply,
        {
          text: command.text,
          status: 'approved',
          publicationState: 'authorized',
          publicationAttempts: 0,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        },
        command.event,
        command.now,
      )
    },

    cancelPublications: async (commands) => {
      let count = 0
      for (const { reply, event, now } of commands) {
        const saved = await publicationTransition(
          reply,
          'cancel',
          ['requested', 'authorized', 'sending'],
          { status: 'draft', publicationState: 'cancelled' },
          null,
          now,
        )
        if (saved) {
          await recordAndEmit(event)
          count++
        }
      }
      return count
    },

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
