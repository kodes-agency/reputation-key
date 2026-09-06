// Sequential inbox command store — NON-transactional test/Storybook fake
// (BQC-3.4). Lives in shared/testing (with the in-memory inbox repo) so
// application-zone tests and browser bundles (Storybook) can use it without
// importing the drizzle-backed atomic store (application must not import
// infrastructure). Applies the same operation order (state → outbox)
// against the repository ports without a real transaction.
//
// Not for production — production must use createAtomicInboxCommandStore
// (src/contexts/inbox/infrastructure/inbox-command-store.ts).

import { createRecordedOutbox, type RecordedOutbox } from './recorded-outbox'
import { timestampFieldsForStatus } from '#/contexts/inbox/domain/rules'
import type { InboxRepository } from '#/contexts/inbox/application/ports/inbox.repository'
import type { InboxNoteRepository } from '#/contexts/inbox/application/ports/inbox-note.repository'
import type {
  ApplyReceiptStatus,
  InboxCommandStore,
} from '#/contexts/inbox/application/ports/inbox-command-store.port'
import {
  inboxBulkAssignmentCompleted,
  inboxItemAssigned,
  inboxItemStatusChanged,
  inboxItemUnassigned,
} from '#/contexts/inbox/domain/events'

export function createSequentialInboxCommandStore(deps: {
  repo: InboxRepository
  noteRepo?: InboxNoteRepository
  outbox?: RecordedOutbox
  recordReceipt?: (
    eventId: string,
    consumerName: string,
    status: ApplyReceiptStatus,
  ) => Promise<void>
}): InboxCommandStore {
  const outbox = deps.outbox ?? createRecordedOutbox()
  const recordAndEmit = outbox.record

  const receipt = async (
    eventId: string,
    consumerName: string,
    status: ApplyReceiptStatus,
  ): Promise<void> => {
    if (deps.recordReceipt) await deps.recordReceipt(eventId, consumerName, status)
  }

  return {
    releaseAssignmentsForUser: async () => ({ released: 0 }),
    releaseIneligibleAssignmentsForUser: async () => ({ released: 0 }),
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

    reopenReviewCycle: async (command) => {
      const saved = await deps.repo.updateStatus(
        command.item.id,
        command.item.organizationId,
        'open',
        { closedAt: null },
        command.now,
      )
      await recordAndEmit(command.fact)
      return saved
    },

    bulkUpdateStatus: async (items, perItemEvents, _governance) => {
      const first = perItemEvents[0]
      if (!first || items.length === 0) return { updated: 0, results: [] }
      const results = []
      for (const [index, item] of items.entries()) {
        const event = perItemEvents[index]
        if (!event) continue
        await deps.repo.updateStatus(
          item.id,
          item.organizationId,
          event.newStatus,
          timestampFieldsForStatus(event.newStatus, event.occurredAt),
          event.occurredAt,
        )
        await recordAndEmit(event)
        results.push({ inboxItemId: item.id, outcome: 'reopened' as const })
      }
      return { updated: results.length, results }
    },

    bulkAssign: async (command) => {
      const results = []
      const transitions = []
      for (const item of command.items) {
        if (item.assignedTo === command.assignedTo) {
          results.push({ inboxItemId: item.id, outcome: 'unchanged' as const })
          continue
        }
        await deps.repo.updateAssignment(
          item.id,
          item.organizationId,
          command.assignedTo,
          command.occurredAt,
        )
        const fact = command.assignedTo
          ? inboxItemAssigned({
              inboxItemId: item.id,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              userId: command.actorId,
              assignedTo: command.assignedTo,
              bulkId: command.bulkId,
              occurredAt: command.occurredAt,
            })
          : inboxItemUnassigned({
              inboxItemId: item.id,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              userId: command.actorId,
              previousAssignee: item.assignedTo!,
              bulkId: command.bulkId,
              occurredAt: command.occurredAt,
            })
        await recordAndEmit(fact)
        const outcome =
          command.assignedTo === null
            ? ('released' as const)
            : item.assignedTo === null
              ? ('assigned' as const)
              : ('reassigned' as const)
        results.push({ inboxItemId: item.id, outcome })
        transitions.push({
          inboxItemId: item.id,
          propertyId: item.propertyId,
          previousAssignee: item.assignedTo,
          nextAssignee: command.assignedTo,
        })
      }
      if (transitions.length > 0) {
        const completed = inboxBulkAssignmentCompleted({
          organizationId: command.items[0]!.organizationId,
          userId: command.actorId,
          bulkId: command.bulkId,
          transitions,
          occurredAt: command.occurredAt,
        })
        await recordAndEmit(completed)
      }
      return { updated: transitions.length, results }
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

    addNote: async (item, note, event) => {
      if (!deps.noteRepo) throw new Error('noteRepo is required for addNote')
      // The production transaction advances the item's optimistic-concurrency
      // fence before inserting the note. Reuse the repository's assignment
      // update as a browser-safe touch while preserving the assignee value.
      await deps.repo.updateAssignment(
        item.id,
        item.organizationId,
        item.assignedTo,
        note.createdAt,
      )
      const saved = await deps.noteRepo.create(note, note.organizationId)
      await recordAndEmit(event)
      return saved
    },

    applySourceCreatedOnce: async (command) => {
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

    applyReviewProjectionOnce: async (command) => {
      let current = await deps.repo.findBySource(
        'review',
        command.item.sourceId as string,
        command.item.organizationId,
      )
      const created = current === null
      if (!current) {
        current = await deps.repo.create(command.item, command.item.organizationId)
        await recordAndEmit(command.fact)
      }
      await deps.repo.updateSourceMeta(
        current.id,
        current.organizationId,
        {
          sourceDate: command.projection.sourceDate,
          platform: command.projection.platform,
        },
        command.now,
      )
      if (
        command.projection.sourceContentState !== 'active' &&
        current.status === 'open' &&
        command.projection.sourceContentErasedAt instanceof Date
      ) {
        await deps.repo.updateStatus(
          current.id,
          current.organizationId,
          'closed',
          { closedAt: command.projection.sourceContentErasedAt },
          command.now,
        )
        await recordAndEmit(
          inboxItemStatusChanged({
            inboxItemId: current.id,
            organizationId: current.organizationId,
            propertyId: current.propertyId,
            oldStatus: 'open',
            newStatus: 'closed',
            occurredAt: command.projection.sourceContentErasedAt,
          }),
        )
      }
      const outcome =
        command.eventKind === 'created' && !created ? 'duplicate' : 'applied'
      await receipt(command.eventId, command.consumerName, outcome)
      return outcome
    },

    applySourceWithdrawnOnce: async (command) => {
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

    applyReviewSourceTransitionedOnce: async (command) => {
      const current = await deps.repo.findById(
        command.item.id,
        command.item.organizationId,
      )
      if (current?.sourceType === 'review') {
        if (command.closeIfOpen && current.status === 'open') {
          await deps.repo.updateStatus(
            current.id,
            current.organizationId,
            'closed',
            { closedAt: command.transitionedAt },
            command.transitionedAt,
          )
          await recordAndEmit(command.closeFact)
        }
        await deps.repo.clearReviewSourceContent(
          current.id,
          current.organizationId,
          command.transitionedAt,
        )
      }
      await receipt(command.eventId, command.consumerName, 'applied')
      return 'applied'
    },

    applyReplyPublishedOnce: async (command) => {
      await receipt(command.eventId, command.consumerName, 'applied')
      return 'applied'
    },

    applyReplyObservedOnce: async (command) => {
      const observation = command.currentObservation
      const current = await deps.repo.findById(
        command.item.id,
        command.item.organizationId,
      )
      if (!current) {
        await receipt(command.eventId, command.consumerName, 'obsolete')
        return 'obsolete'
      }
      const shouldClose =
        observation.state === 'live' &&
        (observation.resolution === 'confirmed_on_google' ||
          observation.resolution === 'external_current_live')
      const shouldReopen =
        observation.state === 'absent' &&
        observation.resolution === 'absent' &&
        observation.change === 'deleted'
      if (shouldClose && current.status === 'open') {
        await deps.repo.updateStatus(
          current.id,
          current.organizationId,
          'closed',
          {
            closedAt: observation.observedAt,
            ...(current.firstReplyPublishedAt === null
              ? { firstReplyPublishedAt: observation.observedAt }
              : {}),
          },
          observation.observedAt,
        )
        await recordAndEmit(command.closeFact)
      } else if (shouldReopen && current.status === 'closed') {
        await deps.repo.updateStatus(
          current.id,
          current.organizationId,
          'open',
          { closedAt: null },
          observation.observedAt,
        )
        await recordAndEmit(command.reopenFact)
      }
      await receipt(command.eventId, command.consumerName, 'applied')
      return 'applied'
    },

    recordReceipt: receipt,
  }
}
