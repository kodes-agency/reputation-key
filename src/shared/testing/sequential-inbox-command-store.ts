// Sequential inbox command store — NON-transactional test/Storybook fake
// (BQC-3.4). Lives in shared/testing (with the in-memory inbox repo) so
// application-zone tests and browser bundles (Storybook) can use it without
// importing the drizzle-backed atomic store (application must not import
// infrastructure). Applies the same operation order (state → outbox → emit)
// against the repository ports without a real transaction.
//
// Not for production — production must use createAtomicInboxCommandStore
// (src/contexts/inbox/infrastructure/inbox-command-store.ts).

import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { getLogger } from '#/shared/observability/logger'
import { timestampFieldsForStatus } from '#/contexts/inbox/domain/rules'
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import type { InboxNoteRepository } from '#/contexts/inbox/application/ports/inbox-note.repository'
import type {
  ApplyReceiptStatus,
  InboxCommandStore,
} from '#/contexts/inbox/application/ports/inbox-command-store.port'

/** Post-commit emit, failure-isolated — same contract as the atomic store. */
async function emitAfterCommit(events: EventBus, event: DomainEvent): Promise<void> {
  try {
    await events.emit(event)
  } catch (err) {
    getLogger().warn(
      { err, eventType: event._tag, eventId: event.eventId },
      'BQC-3.4: in-process emit failed after sequential store state write',
    )
  }
}

export function createSequentialInboxCommandStore(deps: {
  repo: InboxRepository
  noteRepo?: InboxNoteRepository
  events: EventBus
  recordOutbox?: (event: DomainEvent) => Promise<void>
  recordReceipt?: (
    eventId: string,
    consumerName: string,
    status: ApplyReceiptStatus,
  ) => Promise<void>
}): InboxCommandStore {
  const recordAndEmit = async (event: DomainEvent): Promise<void> => {
    if (deps.recordOutbox) await deps.recordOutbox(event)
    await emitAfterCommit(deps.events, event)
  }

  const receipt = async (
    eventId: string,
    consumerName: string,
    status: ApplyReceiptStatus,
  ): Promise<void> => {
    if (deps.recordReceipt) await deps.recordReceipt(eventId, consumerName, status)
  }

  return {
    createItem: async (item, event) => {
      const existing = await deps.repo.findBySource(
        item.sourceType,
        item.sourceId as string,
        item.organizationId,
      )
      if (existing) return { item: existing, created: false }
      const created = await deps.repo.create(item, item.organizationId)
      if (event) await recordAndEmit(event)
      return { item: created, created: true }
    },

    updateStatus: async (item, updates, event, now) => {
      const saved = await deps.repo.updateStatus(
        item.id,
        item.organizationId,
        updates.status,
        updates.timestampFields,
        now,
      )
      if (event) await recordAndEmit(event)
      return saved
    },

    bulkUpdateStatus: async (items, perItemEvents) => {
      const first = perItemEvents[0]
      if (!first || items.length === 0) return { updated: 0 }
      const result = await deps.repo.bulkUpdateStatus(
        items.map((item) => item.id),
        items[0]!.organizationId,
        first.newStatus,
        timestampFieldsForStatus(first.newStatus, first.occurredAt),
        first.occurredAt,
      )
      for (const event of perItemEvents) await recordAndEmit(event)
      return result
    },

    assign: async (item, updates, event, now) => {
      const saved = await deps.repo.updateAssignment(
        item.id,
        item.organizationId,
        updates.assignedTo,
        now,
      )
      if (event) await recordAndEmit(event)
      return saved
    },

    escalate: async (item, updates, event, now) => {
      const saved = await deps.repo.setEscalation(
        item.id,
        item.organizationId,
        updates.escalatedBy,
        now,
      )
      await recordAndEmit(event)
      return saved
    },

    resolveEscalation: async (item, updates, event, now) => {
      const saved = await deps.repo.resolveEscalation(
        item.id,
        item.organizationId,
        updates.resolvedBy,
        now,
      )
      await recordAndEmit(event)
      return saved
    },

    addNote: async (note, event) => {
      if (!deps.noteRepo) throw new Error('noteRepo is required for addNote')
      const saved = await deps.noteRepo.create(note, note.organizationId)
      await recordAndEmit(event)
      return saved
    },

    applyReviewCreatedOnce: async (command) => {
      const existing = await deps.repo.findBySource(
        command.item.sourceType,
        command.item.sourceId as string,
        command.item.organizationId,
      )
      if (existing) {
        await receipt(command.eventId, command.consumerName, 'duplicate')
        return 'duplicate'
      }
      await deps.repo.create(command.item, command.item.organizationId)
      await recordAndEmit(command.fact)
      await receipt(command.eventId, command.consumerName, 'applied')
      return 'applied'
    },

    applyReviewExpiredOnce: async (command) => {
      const current = await deps.repo.findById(
        command.item.id,
        command.item.organizationId,
      )
      if (current && current.status === command.item.status) {
        await deps.repo.updateStatus(
          command.item.id,
          command.item.organizationId,
          command.fact.newStatus,
          { closedAt: command.now },
          command.now,
        )
        await recordAndEmit(command.fact)
      }
      await receipt(command.eventId, command.consumerName, 'applied')
      return 'applied'
    },

    applyReviewUpdatedOnce: async (command) => {
      await deps.repo.updateSourceMeta(
        command.item.id,
        command.item.organizationId,
        { sourceDate: command.sourceDate, platform: command.platform },
        command.now,
      )
      await receipt(command.eventId, command.consumerName, 'applied')
      return 'applied'
    },

    applyReplyPublishedOnce: async (command) => {
      const current = await deps.repo.findById(
        command.item.id,
        command.item.organizationId,
      )
      if (current && current.status === command.item.status) {
        const fields: Partial<Record<string, Date>> = {}
        if (command.closeItem) fields.closedAt = command.occurredAt
        if (command.stampMilestone) fields.firstReplyPublishedAt = command.occurredAt
        await deps.repo.updateStatus(
          command.item.id,
          command.item.organizationId,
          command.closeItem ? 'closed' : command.item.status,
          fields,
          command.occurredAt,
        )
        if (command.fact) await recordAndEmit(command.fact)
      }
      await receipt(command.eventId, command.consumerName, 'applied')
      return 'applied'
    },

    recordReceipt: receipt,
  }
}
