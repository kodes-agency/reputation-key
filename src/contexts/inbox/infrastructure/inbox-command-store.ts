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
import { inboxItems, inboxNotes } from '#/shared/db/schema/inbox.schema'
import { outboxEvents, eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import type { InboxItemId, OrganizationId } from '#/shared/domain/ids'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'
import type { InboxItem } from '../domain/types'
import { inboxError } from '../domain/errors'
import { timestampFieldsForStatus } from '../domain/rules'
import { inboxItemFromRow, inboxItemToInsertRow } from './mappers/inbox.mapper'
import { inboxNoteFromRow, inboxNoteToInsertRow } from './mappers/inbox-note.mapper'
import type {
  ApplyReceiptStatus,
  InboxCommandStore,
} from '../application/ports/inbox-command-store.port'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  // Expand-phase dual path: durable outbox already committed. Bus failure must
  // not roll back or hide the durable fact (relay will deliver when enabled).
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.4: in-process emit failed after atomic outbox commit — durable row retained',
    )
  }
}

async function insertOutboxRow(tx: Tx, event: DomainEvent): Promise<void> {
  await tx.insert(outboxEvents).values({ ...toOutboxEvent(event), id: event.eventId })
}

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
): Promise<{ item: InboxItem; created: boolean }> {
  const inserted = await tx
    .insert(inboxItems)
    .values(inboxItemToInsertRow(item))
    .onConflictDoNothing({
      target: [inboxItems.sourceType, inboxItems.sourceId, inboxItems.organizationId],
    })
    .returning()
  if (inserted[0]) return { item: itemFromRow(inserted[0]), created: true }
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
    createItem: async (item, event) => {
      return trace('inbox.commandStore.createItem', async () => {
        const result = await db.transaction(async (tx) => {
          const inserted = await insertItemIdempotent(tx, item)
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

    applyReviewCreatedOnce: async (command) => {
      return trace('inbox.commandStore.applyReviewCreatedOnce', async () => {
        const outcome = await db.transaction(async (tx) => {
          const inserted = await insertItemIdempotent(tx, command.item)
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
      const set: Record<string, unknown> = { updatedAt: command.occurredAt }
      if (command.closeItem) {
        set.status = 'closed'
        set.closedAt = command.occurredAt
      }
      if (command.stampMilestone) set.firstReplyPublishedAt = command.occurredAt
      return applyGuarded(
        'inbox.commandStore.applyReplyPublishedOnce',
        command.item,
        set,
        command.fact,
        { eventId: command.eventId, consumerName: command.consumerName },
      )
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
