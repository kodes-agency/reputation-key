// Atomic inbox command store (BQC-3.4).
//
// One PostgreSQL transaction per command: inbox state mutation + outbox_events
// fact insert (+ consumer receipt for the projection applyOnce paths). After
// commit: in-process EventBus emit for expand-phase legacy consumers.
//
// Crash contract:
// - Crash anywhere inside the transaction rolls back the state mutation, the
//   outbox rows, AND the receipt together — no state/outbox/receipt split is
//   ever observable (the pre-BQC-3.4 consumers could lose the
//   inbox_item.status_changed fact between separate awaits).
// - Crash after commit but before the bus emit leaves a durable outbox row
//   for the relay; the emit is best-effort (failure-isolated, logged).
// - createItem is idempotent on the (sourceType, sourceId, organizationId)
//   unique anchor: a conflicting concurrent insert re-selects the existing
//   row and records NO fact — the projection path and rebuild depend on this.
// - A guarded applyOnce transition that matches no row (lost TOCTOU race)
//   records the receipt but NO fact — redelivery converges, rebuild heals.

import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  inboxHandlingCycleHeads,
  inboxHandlingCycles,
  inboxItems,
  inboxNotes,
} from '#/shared/db/schema/inbox.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { emitAfterCommit, insertOutboxRow, type Tx } from '#/shared/outbox/commit'
import {
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
  type InboxItemId,
  type OrganizationId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { InboxItem } from '../domain/types'
import { inboxError } from '../domain/errors'
import { inboxItemUnassigned } from '../domain/events'
import { timestampFieldsForStatus } from '../domain/rules'
import { inboxItemFromRow, inboxItemToInsertRow } from './mappers/inbox.mapper'
import { inboxNoteFromRow, inboxNoteToInsertRow } from './mappers/inbox-note.mapper'
import { insertInitialReviewHandlingCycle } from './review-handling-cycle.store'
import { createNextReviewHandlingCycle } from '../domain/handling-cycles'
import type {
  ApplyReceiptStatus,
  InboxCommandStore,
  ReviewCycleCreationAnchor,
} from '../application/ports/inbox-command-store.port'

async function insertReceiptRow(
  tx: Tx,
  eventId: string,
  consumerName: string,
  status: ApplyReceiptStatus,
): Promise<void> {
  await tx
    .insert(eventConsumerReceipts)
    .values({ eventId, consumerName, status })
    .onConflictDoNothing()
}

/** Reserve a delivery inside the apply transaction. A concurrent duplicate
 * blocks on the receipt key and then observes no returned row, so it cannot
 * repeat a close/reopen after a later workflow transition. */
async function reserveReceiptRow(
  tx: Tx,
  eventId: string,
  consumerName: string,
): Promise<boolean> {
  const rows = await tx
    .insert(eventConsumerReceipts)
    .values({ eventId, consumerName, status: 'applied' })
    .onConflictDoNothing()
    .returning({ eventId: eventConsumerReceipts.eventId })
  return rows.length === 1
}

const itemFromRow = (row: typeof inboxItems.$inferSelect): InboxItem => ({
  ...inboxItemFromRow(row),
  propertyName: null,
})

/**
 * Idempotent insert on the (sourceType, sourceId, organizationId) unique
 * anchor. Returns the inserted row, or the pre-existing row with
 * `created: false` after a re-select — never throws on the unique race.
 */
async function insertItemIdempotent(
  tx: Tx,
  item: InboxItem,
  reviewCycleAnchor?: ReviewCycleCreationAnchor,
): Promise<{ item: InboxItem; created: boolean }> {
  const inserted = await tx
    .insert(inboxItems)
    .values(inboxItemToInsertRow(item))
    .onConflictDoNothing({
      target: [inboxItems.sourceType, inboxItems.sourceId, inboxItems.organizationId],
    })
    .returning()
  if (inserted[0]) {
    if (reviewCycleAnchor) {
      await insertInitialReviewHandlingCycle(
        tx,
        itemFromRow(inserted[0]),
        reviewCycleAnchor.materialReviewRevision,
      )
    }
    return { item: itemFromRow(inserted[0]), created: true }
  }
  const existing = await tx
    .select()
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.sourceType, item.sourceType),
        eq(inboxItems.sourceId, item.sourceId as string),
        eq(inboxItems.organizationId, item.organizationId),
      ),
    )
    .limit(1)
  if (!existing[0]) {
    // Conflict without a visible row — the racing transaction rolled back
    // between our insert and re-select. Surface as a retryable failure.
    throw inboxError('not_found', 'Inbox item insert conflicted but no row is visible')
  }
  return { item: itemFromRow(existing[0]), created: false }
}

/** Single-row update mirroring InboxRepository's not_found contract. */
async function updateItemRow(
  tx: Tx,
  id: InboxItemId,
  orgId: OrganizationId,
  set: Record<string, unknown>,
  notFoundMessage: string,
): Promise<InboxItem> {
  const result = await tx
    .update(inboxItems)
    .set(set)
    .where(and(eq(inboxItems.id, id), eq(inboxItems.organizationId, orgId)))
    .returning()
  if (!result[0]) throw inboxError('not_found', notFoundMessage)
  return itemFromRow(result[0])
}

/** Guarded projection update: applies only while the row's status still equals `expected`. */
async function guardedItemUpdate(
  tx: Tx,
  item: InboxItem,
  set: Record<string, unknown>,
): Promise<InboxItem | null> {
  const result = await tx
    .update(inboxItems)
    .set(set)
    .where(
      and(
        eq(inboxItems.id, item.id),
        eq(inboxItems.organizationId, item.organizationId),
        eq(inboxItems.status, item.status),
      ),
    )
    .returning()
  return result[0] ? itemFromRow(result[0]) : null
}

export function createAtomicInboxCommandStore(
  db: Database,
  events: EventBus,
): InboxCommandStore {
  /** Shared runner: single-row update + optional fact, one transaction. */
  const transition = async (
    span: string,
    item: InboxItem,
    set: Record<string, unknown>,
    notFoundMessage: string,
    event: DomainEvent | null,
  ): Promise<InboxItem> => {
    return trace(span, async () => {
      const saved = await db.transaction(async (tx) => {
        const row = await updateItemRow(
          tx,
          item.id,
          item.organizationId,
          set,
          notFoundMessage,
        )
        if (event) await insertOutboxRow(tx, event)
        return row
      })
      if (event) await emitAfterCommit(events, event)
      return saved
    })
  }

  /** Shared runner for the guarded-transition projection applyOnce commands. */
  const applyGuarded = async (
    span: string,
    item: InboxItem,
    set: Record<string, unknown>,
    fact: DomainEvent | null,
    receipt: Readonly<{ eventId: string; consumerName: string }>,
  ): Promise<'applied'> => {
    return trace(span, async () => {
      const landed = await db.transaction(async (tx) => {
        const row = await guardedItemUpdate(tx, item, set)
        if (row && fact) await insertOutboxRow(tx, fact)
        await insertReceiptRow(tx, receipt.eventId, receipt.consumerName, 'applied')
        return row !== null
      })
      if (landed && fact) await emitAfterCommit(events, fact)
      return 'applied' as const
    })
  }

  return {
    releaseAssignmentsForUser: async (input) => {
      return trace('inbox.commandStore.releaseAssignmentsForUser', async () => {
        const facts = await db.transaction(async (tx) => {
          const released = await tx
            .update(inboxItems)
            .set({ assignedTo: null, updatedAt: input.at })
            .where(
              and(
                eq(inboxItems.organizationId, input.organizationId),
                eq(inboxItems.assignedTo, input.userId),
              ),
            )
            .returning()
          const events = released.map((row) =>
            inboxItemUnassigned({
              inboxItemId: row.id as import('#/shared/domain/ids').InboxItemId,
              organizationId: input.organizationId,
              propertyId: row.propertyId as import('#/shared/domain/ids').PropertyId,
              userId: input.actorId ?? undefined,
              previousAssignee: input.userId,
              source: 'web',
              occurredAt: input.at,
            }),
          )
          for (const event of events) await insertOutboxRow(tx, event)
          return events
        })
        for (const event of facts) await emitAfterCommit(events, event)
        return { released: facts.length }
      })
    },

    createItem: async (item, event, reviewCycleAnchor) => {
      return trace('inbox.commandStore.createItem', async () => {
        const result = await db.transaction(async (tx) => {
          const inserted = await insertItemIdempotent(tx, item, reviewCycleAnchor)
          if (inserted.created && event) await insertOutboxRow(tx, event)
          return inserted
        })
        if (result.created && event) await emitAfterCommit(events, event)
        return result
      })
    },

    updateStatus: (item, updates, event, now) =>
      transition(
        'inbox.commandStore.updateStatus',
        item,
        {
          status: updates.status,
          updatedAt: now ?? new Date(),
          ...updates.timestampFields,
        },
        'Inbox item status update failed — no row returned',
        event,
      ),

    bulkUpdateStatus: async (items, perItemEvents) => {
      return trace('inbox.commandStore.bulkUpdateStatus', async () => {
        const first = perItemEvents[0]
        if (!first || items.length === 0) return { updated: 0 }
        const now = first.occurredAt
        const set = {
          status: first.newStatus,
          updatedAt: now,
          ...timestampFieldsForStatus(first.newStatus, now),
        }
        const orgId = items[0]!.organizationId
        const ids = items.map((item) => item.id as string)
        const updated = await db.transaction(async (tx) => {
          // ONE bulk update + N per-item outbox rows — the fan-out is atomic.
          const result = await tx
            .update(inboxItems)
            .set(set)
            .where(and(eq(inboxItems.organizationId, orgId), inArray(inboxItems.id, ids)))
            .returning()
          for (const event of perItemEvents) await insertOutboxRow(tx, event)
          return result.length
        })
        for (const event of perItemEvents) await emitAfterCommit(events, event)
        return { updated }
      })
    },

    assign: (item, updates, event, now) =>
      transition(
        'inbox.commandStore.assign',
        item,
        { assignedTo: updates.assignedTo, updatedAt: now ?? new Date() },
        'Inbox item assignment update failed — no row returned',
        event,
      ),

    escalate: (item, updates, event, now) => {
      const stamp = now ?? new Date()
      return transition(
        'inbox.commandStore.escalate',
        item,
        {
          isEscalated: true,
          escalatedAt: stamp,
          escalatedBy: updates.escalatedBy,
          escalationResolvedAt: null,
          escalationResolvedBy: null,
          updatedAt: stamp,
        },
        'Inbox item escalation update failed — no row returned',
        event,
      )
    },

    resolveEscalation: (item, updates, event, now) => {
      const stamp = now ?? new Date()
      return transition(
        'inbox.commandStore.resolveEscalation',
        item,
        {
          isEscalated: false,
          escalationResolvedAt: stamp,
          escalationResolvedBy: updates.resolvedBy,
          updatedAt: stamp,
        },
        'Inbox item resolve-escalation failed — no row returned',
        event,
      )
    },

    addNote: async (note, event) => {
      return trace('inbox.commandStore.addNote', async () => {
        const saved = await db.transaction(async (tx) => {
          const result = await tx
            .insert(inboxNotes)
            .values(inboxNoteToInsertRow(note))
            .returning()
          if (!result[0]) {
            throw inboxError('not_found', 'Inbox note insert failed — no row returned')
          }
          await insertOutboxRow(tx, event)
          return inboxNoteFromRow(result[0])
        })
        await emitAfterCommit(events, event)
        return saved
      })
    },

    applySourceCreatedOnce: async (command) => {
      return trace('inbox.commandStore.applySourceCreatedOnce', async () => {
        const outcome = await db.transaction(async (tx) => {
          const inserted = await insertItemIdempotent(
            tx,
            command.item,
            command.reviewCycleAnchor,
          )
          if (!inserted.created) {
            await insertReceiptRow(tx, command.eventId, command.consumerName, 'duplicate')
            return 'duplicate' as const
          }
          await insertOutboxRow(tx, command.fact)
          await insertReceiptRow(tx, command.eventId, command.consumerName, 'applied')
          return 'applied' as const
        })
        if (outcome === 'applied') await emitAfterCommit(events, command.fact)
        return outcome
      })
    },

    applyReviewExpiredOnce: (command) =>
      applyGuarded(
        'inbox.commandStore.applyReviewExpiredOnce',
        command.item,
        {
          status: command.fact.newStatus,
          closedAt: command.now,
          updatedAt: command.now,
        },
        command.fact,
        { eventId: command.eventId, consumerName: command.consumerName },
      ),

    applySourceWithdrawnOnce: (command) =>
      applyGuarded(
        'inbox.commandStore.applySourceWithdrawnOnce',
        command.item,
        {
          status: command.fact.newStatus,
          closedAt: command.now,
          updatedAt: command.now,
        },
        command.fact,
        { eventId: command.eventId, consumerName: command.consumerName },
      ),

    applyReviewUpdatedOnce: async (command) => {
      return trace('inbox.commandStore.applyReviewUpdatedOnce', async () => {
        await db.transaction(async (tx) => {
          // Metadata-only refresh — no fact: this is not new inbox information.
          await tx
            .update(inboxItems)
            .set({
              sourceDate: command.sourceDate,
              platform: command.platform,
              updatedAt: command.now,
            })
            .where(
              and(
                eq(inboxItems.id, command.item.id),
                eq(inboxItems.organizationId, command.item.organizationId),
              ),
            )
          await insertReceiptRow(tx, command.eventId, command.consumerName, 'applied')
        })
        return 'applied' as const
      })
    },

    applyReplyPublishedOnce: async (command) => {
      return trace('inbox.commandStore.applyReplyPublishedOnce', async () => {
        await db.transaction(async (tx) => {
          await insertReceiptRow(tx, command.eventId, command.consumerName, 'applied')
        })
        return 'applied' as const
      })
    },

    applyReplyObservedOnce: async (command) => {
      return trace('inbox.commandStore.applyReplyObservedOnce', async () => {
        const outcome = await db.transaction(async (tx) => {
          if (!(await reserveReceiptRow(tx, command.eventId, command.consumerName))) {
            return { status: 'applied' as const, fact: null }
          }

          const observation = command.currentObservation
          if (
            observation.authority !== 'review.current-google-reply-observation.v1' ||
            observation.organizationId !== command.item.organizationId ||
            observation.propertyId !== command.item.propertyId ||
            observation.reviewId !== command.item.sourceId
          ) {
            throw inboxError(
              'invalid_input',
              'Review observation permit does not match the Inbox item',
            )
          }

          // Canonical Review Handling Cycle lock order is head -> Inbox item.
          // `startNext` uses the same order; reversing it here lets a material
          // revision/reopen race form a PostgreSQL row-lock cycle.
          const headRows = await tx
            .select()
            .from(inboxHandlingCycleHeads)
            .where(
              and(
                eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                eq(inboxHandlingCycleHeads.organizationId, command.item.organizationId),
                eq(inboxHandlingCycleHeads.reviewId, observation.reviewId),
              ),
            )
            .for('update')
            .limit(1)
          const itemRows = await tx
            .select()
            .from(inboxItems)
            .where(
              and(
                eq(inboxItems.id, command.item.id),
                eq(inboxItems.organizationId, command.item.organizationId),
                eq(inboxItems.propertyId, observation.propertyId),
                eq(inboxItems.sourceType, 'review'),
                eq(inboxItems.sourceId, observation.reviewId),
              ),
            )
            .for('update')
            .limit(1)
          const headRow = headRows[0]
          const itemRow = itemRows[0]
          if (!itemRow || !headRow) {
            throw inboxError(
              'not_found',
              'Review Inbox item or Handling Cycle head not found',
            )
          }
          if (
            itemRow.status !== headRow.status ||
            headRow.currentMaterialReviewRevision !== observation.materialReviewRevision
          ) {
            throw inboxError(
              'revision_conflict',
              'Review Inbox Handling Cycle is not current for this observation',
            )
          }

          const shouldClose =
            observation.state === 'live' &&
            (observation.resolution === 'confirmed_on_google' ||
              observation.resolution === 'external_current_live')
          const reopenReason =
            observation.state === 'absent' &&
            observation.change === 'deleted' &&
            observation.resolution === 'absent'
              ? ('provider_reply_deleted' as const)
              : null

          if (shouldClose && itemRow.status === 'open') {
            const nextStateRevision = headRow.stateRevision + 1
            if (!Number.isSafeInteger(nextStateRevision)) {
              throw inboxError('invalid_input', 'Handling Cycle revision limit reached')
            }
            await tx
              .update(inboxHandlingCycleHeads)
              .set({
                status: 'closed',
                stateRevision: nextStateRevision,
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                  eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
                  eq(inboxHandlingCycleHeads.status, 'open'),
                ),
              )
            await tx
              .update(inboxItems)
              .set({
                status: 'closed',
                closedAt: observation.observedAt,
                ...(itemRow.firstReplyPublishedAt === null
                  ? { firstReplyPublishedAt: observation.observedAt }
                  : {}),
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxItems.id, command.item.id),
                  eq(inboxItems.organizationId, command.item.organizationId),
                  eq(inboxItems.status, 'open'),
                ),
              )
            await insertOutboxRow(tx, command.closeFact)
            return { status: 'applied' as const, fact: command.closeFact }
          }

          if (reopenReason !== null && itemRow.status === 'closed') {
            const current = {
              inboxItemId: inboxItemId(headRow.inboxItemId),
              organizationId: organizationId(headRow.organizationId),
              propertyId: propertyId(headRow.propertyId),
              reviewId: reviewId(headRow.reviewId),
              currentCycleNumber: headRow.currentCycleNumber,
              currentMaterialReviewRevision: headRow.currentMaterialReviewRevision,
              stateRevision: headRow.stateRevision,
              status: headRow.status,
            }
            const decision = createNextReviewHandlingCycle({
              current,
              materialReviewRevision: observation.materialReviewRevision,
              openedReason: reopenReason,
              openedBy: null,
              openedAt: observation.observedAt,
            })
            if (decision.isErr()) throw decision.error
            await tx.insert(inboxHandlingCycles).values({
              ...decision.value.cycle,
              createdAt: observation.observedAt,
            })
            await tx
              .update(inboxHandlingCycleHeads)
              .set({
                currentCycleNumber: decision.value.head.currentCycleNumber,
                currentMaterialReviewRevision:
                  decision.value.head.currentMaterialReviewRevision,
                stateRevision: decision.value.head.stateRevision,
                status: 'open',
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxHandlingCycleHeads.inboxItemId, command.item.id),
                  eq(inboxHandlingCycleHeads.stateRevision, headRow.stateRevision),
                  eq(inboxHandlingCycleHeads.status, 'closed'),
                ),
              )
            await tx
              .update(inboxItems)
              .set({
                status: 'open',
                closedAt: null,
                updatedAt: observation.observedAt,
              })
              .where(
                and(
                  eq(inboxItems.id, command.item.id),
                  eq(inboxItems.organizationId, command.item.organizationId),
                  eq(inboxItems.status, 'closed'),
                ),
              )
            await insertOutboxRow(tx, command.reopenFact)
            return { status: 'applied' as const, fact: command.reopenFact }
          }

          return { status: 'applied' as const, fact: null }
        })
        if (outcome.fact) await emitAfterCommit(events, outcome.fact)
        return outcome.status
      })
    },

    recordReceipt: async (eventId, consumerName, status) => {
      return trace('inbox.commandStore.recordReceipt', async () => {
        await db.transaction(async (tx) => {
          await insertReceiptRow(tx, eventId, consumerName, status)
        })
      })
    },
  }
}
