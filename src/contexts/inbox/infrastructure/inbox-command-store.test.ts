// BQC-3.4 — atomic inbox command store contract tests.
//
// Every command must commit its state mutation and its outbox_events row in
// ONE transaction, then emit on the in-process bus AFTER commit:
//   ['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit']
// Projection applyOnce commands additionally co-commit the consumer receipt
// inside the same transaction:
//   ['tx.start', 'tx.state', 'tx.outbox', 'tx.receipt', 'tx.commit', 'emit']
// A lost guarded-transition race commits the receipt only — no fact, no emit.
// A post-commit bus failure must not propagate (durable row already retained).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAtomicInboxCommandStore } from './inbox-command-store'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import type { Database } from '#/shared/db'
import { inboxNotes } from '#/shared/db/schema/inbox.schema'
import { outboxEvents, eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  inboxNoteId,
  organizationId,
  propertyId,
  reviewId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxNote } from '../domain/types'
import {
  inboxItemAssigned,
  inboxItemBulkStatusChanged,
  inboxItemCreated,
  inboxItemEscalated,
  inboxItemEscalationResolved,
  inboxItemStatusChanged,
  inboxItemUnassigned,
  inboxNoteAdded,
} from '../domain/events'
import { isInboxError } from '../domain/errors'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import type { InboxNoteRepository } from '../application/ports/inbox-note.repository'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  }),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const NOW = new Date('2026-06-01T12:00:00.000Z')
const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const ITEM_ID = inboxItemId('ii-1')
const NOTE_ID = inboxNoteId('note-1')
const REVIEW_ID = reviewId('rev-1')
const USER_ID = userId('user-1')
const USER_B = userId('user-2')

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review',
    sourceId: REVIEW_ID,
    status: 'open',
    rating: null,
    sourceDate: new Date('2026-05-20'),
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeNote(overrides: Partial<InboxNote> = {}): InboxNote {
  return {
    id: NOTE_ID,
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    text: 'context-owned note text',
    createdAt: NOW,
    ...overrides,
  }
}

/** DB row shape as drizzle returns it (camelCase keys, timestamps present). */
function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID as string,
    organizationId: ORG_ID as string,
    propertyId: PROP_ID as string,
    sourceType: 'review',
    sourceId: REVIEW_ID as string,
    status: 'open',
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    rating: null,
    sourceDate: new Date('2026-05-20'),
    platform: 'google',
    snippet: null,
    reviewerName: null,
    assignedTo: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeNoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID as string,
    inboxItemId: ITEM_ID as string,
    organizationId: ORG_ID as string,
    userId: USER_ID as string,
    text: 'context-owned note text',
    createdAt: NOW,
    ...overrides,
  }
}

type MockTx = {
  update: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
}

/**
 * Mocked drizzle transaction recording the crash-boundary ordering.
 * `updateRows` — rows returned by UPDATE ... RETURNING ([] = lost race).
 * `insertItemRows` — rows returned by INSERT inbox_items ... ON CONFLICT DO
 *   NOTHING RETURNING ([] = unique conflict on the source anchor).
 * `selectRows` — rows returned by the re-select after a create conflict.
 * `outboxRows` / `receiptRows` — capture every row sent to outbox_events /
 *   event_consumer_receipts.
 */
function createMockDb(opts: {
  order: string[]
  updateRows?: unknown[]
  insertItemRows?: unknown[]
  selectRows?: unknown[]
  noteRows?: unknown[]
  outboxRows?: Array<Record<string, unknown>>
  receiptRows?: Array<Record<string, unknown>>
}) {
  const { order } = opts
  const tx: MockTx = {
    update: vi.fn(() => {
      order.push('tx.state')
      return {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(opts.updateRows ?? []),
          })),
        })),
      }
    }),
    insert: vi.fn((table: unknown) => {
      if (table === outboxEvents) {
        order.push('tx.outbox')
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            opts.outboxRows?.push(row)
          }),
        }
      }
      if (table === eventConsumerReceipts) {
        order.push('tx.receipt')
        return {
          values: vi.fn((row: Record<string, unknown>) => ({
            onConflictDoNothing: vi.fn(async () => {
              opts.receiptRows?.push(row)
            }),
          })),
        }
      }
      order.push('tx.state')
      if (table === inboxNotes) {
        return {
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(opts.noteRows ?? []),
          })),
        }
      }
      return {
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(opts.insertItemRows ?? []),
          })),
        })),
      }
    }),
    select: vi.fn(() => {
      order.push('tx.reselect')
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(opts.selectRows ?? []),
          })),
        })),
      }
    }),
  }
  const db = {
    transaction: vi.fn(async (fn: (txArg: MockTx) => Promise<unknown>) => {
      order.push('tx.start')
      const result = await fn(tx)
      order.push('tx.commit')
      return result
    }),
  }
  return { db: db as unknown as Database, tx }
}

function makeEvents(order: string[], fail = false): EventBus {
  return {
    on: vi.fn(),
    emit: vi.fn(async () => {
      if (fail) throw new Error('bus down')
      order.push('emit')
    }),
    clear: vi.fn(),
  }
}

const createdEvent = () =>
  inboxItemCreated({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review',
    sourceId: REVIEW_ID,
    occurredAt: NOW,
  })

const statusChangedEvent = (oldStatus: 'open' | 'closed' = 'open') =>
  inboxItemStatusChanged({
    inboxItemId: ITEM_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    oldStatus,
    newStatus: oldStatus === 'open' ? 'closed' : 'open',
    userId: USER_ID,
    occurredAt: NOW,
  })

describe('createAtomicInboxCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('createItem', () => {
    it('commits insert + created fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, insertItemRows: [makeItemRow()] })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.createItem(makeItem(), createdEvent())

      expect(result.created).toBe(true)
      expect(result.item.id).toBe(ITEM_ID)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('tolerates the unique source race: re-selects, records no fact, emits nothing', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertItemRows: [],
        selectRows: [makeItemRow({ id: 'ii-existing' })],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.createItem(makeItem(), createdEvent())

      expect(result.created).toBe(false)
      expect(result.item.id).toBe(inboxItemId('ii-existing'))
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.reselect', 'tx.commit'])
    })

    it('null event (rebuild path) commits the insert without a fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, insertItemRows: [makeItemRow()], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.createItem(makeItem(), null)

      expect(result.created).toBe(true)
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
    })
  })

  describe('updateStatus', () => {
    it('commits update + status_changed fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ status: 'closed', closedAt: NOW })],
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.updateStatus(
        makeItem(),
        { status: 'closed', timestampFields: { closedAt: NOW } },
        statusChangedEvent(),
        NOW,
      )

      expect(result.status).toBe('closed')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('null event commits the update without a fact (milestone stamping)', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, updateRows: [makeItemRow()] })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await store.updateStatus(
        makeItem(),
        { status: 'open', timestampFields: { firstReplySubmittedAt: NOW } },
        null,
        NOW,
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
    })

    it('throws not_found when the row vanished (InboxRepository contract)', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateRows: [], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await expect(
        store.updateStatus(
          makeItem(),
          { status: 'closed', timestampFields: { closedAt: NOW } },
          statusChangedEvent(),
          NOW,
        ),
      ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })
  })

  describe('bulkUpdateStatus', () => {
    it('commits ONE bulk update + N per-item facts in one tx, then N emits', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const items = [makeItem(), makeItem({ id: inboxItemId('ii-2') })]
      const bulkId = 'bulk-1'
      const perItemEvents = items.map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: ORG_ID,
          propertyId: item.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          bulkId,
          userId: USER_ID,
          occurredAt: NOW,
        }),
      )
      const { db, tx } = createMockDb({
        order,
        updateRows: [makeItemRow(), makeItemRow({ id: 'ii-2' })],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.bulkUpdateStatus(items, perItemEvents)

      expect(result).toEqual({ updated: 2 })
      expect(tx.update).toHaveBeenCalledTimes(1)
      expect(outboxRows).toHaveLength(2)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.outbox',
        'tx.commit',
        'emit',
        'emit',
      ])
    })

    it('no-ops without a transaction when there are no per-item events', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      const result = await store.bulkUpdateStatus([], [])

      expect(result).toEqual({ updated: 0 })
      expect(order).toEqual([])
    })
  })

  describe('assign', () => {
    it('assign path commits update + assigned fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ assignedTo: USER_B })],
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.assign(
        makeItem(),
        { assignedTo: USER_B },
        inboxItemAssigned({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          assignedTo: USER_B,
          source: 'web',
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(result.assignedTo).toBe(USER_B)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('unassign path commits update + unassigned fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, updateRows: [makeItemRow()] })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await store.assign(
        makeItem({ assignedTo: USER_B }),
        { assignedTo: null },
        inboxItemUnassigned({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          previousAssignee: USER_B,
          source: 'web',
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('null event commits the update without a fact', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, updateRows: [makeItemRow()] })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await store.assign(makeItem(), { assignedTo: null }, null, NOW)

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
    })
  })

  describe('escalate / resolveEscalation', () => {
    it('escalate commits flag update + escalated fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ isEscalated: true, escalatedAt: NOW })],
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.escalate(
        makeItem(),
        { escalatedBy: USER_ID },
        inboxItemEscalated({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(result.isEscalated).toBe(true)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('resolveEscalation commits flag clear + resolved fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ isEscalated: false, escalationResolvedAt: NOW })],
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await store.resolveEscalation(
        makeItem({ isEscalated: true, escalatedAt: NOW }),
        { resolvedBy: USER_ID },
        inboxItemEscalationResolved({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })
  })

  describe('addNote', () => {
    it('commits note insert + note.added fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, noteRows: [makeNoteRow()] })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.addNote(
        makeNote(),
        inboxNoteAdded({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          noteId: NOTE_ID,
          source: 'web',
          occurredAt: NOW,
        }),
      )

      expect(result.id).toBe(NOTE_ID)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })
  })

  describe('applyReviewCreatedOnce', () => {
    it('commits item + created fact + receipt in one tx before emit', async () => {
      const order: string[] = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertItemRows: [makeItemRow()],
        receiptRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReviewCreatedOnce({
        eventId: 'evt-review-created-1',
        consumerName: 'inbox.on-review-created',
        item: makeItem(),
        fact: createdEvent(),
      })

      expect(outcome).toBe('applied')
      expect(receiptRows).toEqual([
        {
          eventId: 'evt-review-created-1',
          consumerName: 'inbox.on-review-created',
          status: 'applied',
        },
      ])
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.receipt',
        'tx.commit',
        'emit',
      ])
    })

    it('duplicate delivery: no second item, no fact, duplicate receipt', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertItemRows: [],
        selectRows: [makeItemRow()],
        outboxRows,
        receiptRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReviewCreatedOnce({
        eventId: 'evt-review-created-1',
        consumerName: 'inbox.on-review-created',
        item: makeItem(),
        fact: createdEvent(),
      })

      expect(outcome).toBe('duplicate')
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(receiptRows).toEqual([
        {
          eventId: 'evt-review-created-1',
          consumerName: 'inbox.on-review-created',
          status: 'duplicate',
        },
      ])
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.reselect',
        'tx.receipt',
        'tx.commit',
      ])
    })
  })

  describe('applyReviewExpiredOnce', () => {
    it('commits guarded close + status_changed fact + receipt in one tx', async () => {
      const order: string[] = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ status: 'closed', closedAt: NOW })],
        receiptRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReviewExpiredOnce({
        eventId: 'evt-review-expired-1',
        consumerName: 'inbox.on-review-expired',
        item: makeItem(),
        now: NOW,
        fact: statusChangedEvent(),
      })

      expect(outcome).toBe('applied')
      expect(receiptRows).toHaveLength(1)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.receipt',
        'tx.commit',
        'emit',
      ])
    })

    it('guard misses (already closed concurrently): receipt only, no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateRows: [], outboxRows, receiptRows })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReviewExpiredOnce({
        eventId: 'evt-review-expired-1',
        consumerName: 'inbox.on-review-expired',
        item: makeItem({ status: 'closed' }),
        now: NOW,
        fact: statusChangedEvent(),
      })

      expect(outcome).toBe('applied')
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(receiptRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.receipt', 'tx.commit'])
    })
  })

  describe('applyReviewUpdatedOnce', () => {
    it('commits metadata refresh + receipt — never a fact, never an emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow()],
        outboxRows,
        receiptRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReviewUpdatedOnce({
        eventId: 'evt-review-updated-1',
        consumerName: 'inbox.on-review-updated',
        item: makeItem(),
        sourceDate: new Date('2026-05-25'),
        platform: 'google',
        now: NOW,
      })

      expect(outcome).toBe('applied')
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(receiptRows).toHaveLength(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.receipt', 'tx.commit'])
    })
  })

  describe('applyReplyPublishedOnce', () => {
    it('close + milestone: commits update + status_changed fact + receipt, then emits', async () => {
      const order: string[] = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ status: 'closed' })],
        receiptRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReplyPublishedOnce({
        eventId: 'evt-reply-published-1',
        consumerName: 'inbox.on-reply-published',
        item: makeItem(),
        occurredAt: NOW,
        closeItem: true,
        stampMilestone: true,
        fact: statusChangedEvent(),
      })

      expect(outcome).toBe('applied')
      expect(receiptRows).toHaveLength(1)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.receipt',
        'tx.commit',
        'emit',
      ])
    })

    it('milestone only (already closed): commits update + receipt, no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ status: 'closed' })],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReplyPublishedOnce({
        eventId: 'evt-reply-published-1',
        consumerName: 'inbox.on-reply-published',
        item: makeItem({ status: 'closed' }),
        occurredAt: NOW,
        closeItem: false,
        stampMilestone: true,
        fact: null,
      })

      expect(outcome).toBe('applied')
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.receipt', 'tx.commit'])
    })

    it('guard misses: receipt only, no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateRows: [], outboxRows })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applyReplyPublishedOnce({
        eventId: 'evt-reply-published-1',
        consumerName: 'inbox.on-reply-published',
        item: makeItem(),
        occurredAt: NOW,
        closeItem: true,
        stampMilestone: true,
        fact: statusChangedEvent(),
      })

      expect(outcome).toBe('applied')
      expect(outboxRows).toHaveLength(0)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.receipt', 'tx.commit'])
    })
  })

  describe('recordReceipt', () => {
    it('inserts only the receipt row (idempotent on conflict)', async () => {
      const order: string[] = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, receiptRows })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await store.recordReceipt('evt-1', 'inbox.on-review-created', 'obsolete')

      expect(receiptRows).toEqual([
        { eventId: 'evt-1', consumerName: 'inbox.on-review-created', status: 'obsolete' },
      ])
    })
  })

  describe('emit failure isolation', () => {
    it('a post-commit bus failure does not propagate (durable row retained)', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ status: 'closed' })],
      })
      const events = makeEvents(order, true)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.updateStatus(
        makeItem(),
        { status: 'closed', timestampFields: { closedAt: NOW } },
        statusChangedEvent(),
        NOW,
      )

      expect(result.status).toBe('closed')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })
  })

  describe('identifier-only payload enforcement (schema allowlist, BQC-3.4 fixes)', () => {
    it('each fixed event passes schema validation with its real producer payload', () => {
      const cases: ReadonlyArray<{ tag: string; make: () => DomainEvent }> = [
        {
          tag: 'inbox.inbox_item.assigned',
          make: () =>
            inboxItemAssigned({
              inboxItemId: ITEM_ID,
              organizationId: ORG_ID,
              propertyId: PROP_ID,
              userId: USER_ID,
              assignedTo: USER_B,
              source: 'web',
              occurredAt: NOW,
            }),
        },
        {
          tag: 'inbox.inbox_item.unassigned',
          make: () =>
            inboxItemUnassigned({
              inboxItemId: ITEM_ID,
              organizationId: ORG_ID,
              propertyId: PROP_ID,
              userId: USER_ID,
              previousAssignee: USER_B,
              source: 'web',
              occurredAt: NOW,
            }),
        },
        {
          tag: 'inbox.inbox_item.escalated',
          make: () =>
            inboxItemEscalated({
              inboxItemId: ITEM_ID,
              organizationId: ORG_ID,
              propertyId: PROP_ID,
              userId: USER_ID,
              occurredAt: NOW,
            }),
        },
        {
          tag: 'inbox.inbox_item.escalation_resolved',
          make: () =>
            inboxItemEscalationResolved({
              inboxItemId: ITEM_ID,
              organizationId: ORG_ID,
              propertyId: PROP_ID,
              userId: USER_ID,
              occurredAt: NOW,
            }),
        },
        {
          tag: 'inbox.inbox_note.added',
          make: () =>
            inboxNoteAdded({
              inboxItemId: ITEM_ID,
              organizationId: ORG_ID,
              propertyId: PROP_ID,
              userId: USER_ID,
              noteId: NOTE_ID,
              source: 'web',
              occurredAt: NOW,
            }),
        },
        {
          tag: 'inbox.inbox_item.bulk_status_changed',
          make: () =>
            inboxItemBulkStatusChanged({
              inboxItemId: ITEM_ID,
              organizationId: ORG_ID,
              propertyId: PROP_ID,
              oldStatus: 'open',
              newStatus: 'closed',
              bulkId: 'bulk-1',
              userId: USER_ID,
              occurredAt: NOW,
            }),
        },
      ]

      for (const { tag, make } of cases) {
        // The real producer pipeline: toOutboxEvent normalizes values, then
        // runs validateEventPayload against the registered allowlist.
        const row = toOutboxEvent(make())
        expect(row.eventType, tag).toBe(tag)
        // And the dispatcher-side re-validation of the stored payload passes.
        expect(() => validateEventPayload(tag, 1, row.payload), tag).not.toThrow()
      }
    })

    it('a smuggled text field on inbox_note.added never reaches the outbox row', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, noteRows: [makeNoteRow()], outboxRows })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      const smuggled = {
        ...inboxNoteAdded({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          noteId: NOTE_ID,
          source: 'web',
          occurredAt: NOW,
        }),
        text: 'raw note text that must never persist',
        noteText: 'alias attempt',
      } as unknown as Parameters<typeof store.addNote>[1]

      await store.addNote(makeNote(), smuggled)

      expect(outboxRows).toHaveLength(1)
      const payload = outboxRows[0]!.payload as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual([
        'inboxItemId',
        'noteId',
        'occurredAt',
        'organizationId',
        'propertyId',
        'source',
        'userId',
      ])
      expect(JSON.stringify(payload)).not.toContain('raw note text')
    })

    it('assigned/unassigned payloads carry the assignee fields, never staffId', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ assignedTo: USER_B })],
        outboxRows,
      })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await store.assign(
        makeItem(),
        { assignedTo: USER_B },
        inboxItemAssigned({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          assignedTo: USER_B,
          source: 'web',
          occurredAt: NOW,
        }),
        NOW,
      )

      const payload = outboxRows[0]!.payload as Record<string, unknown>
      expect(payload.assignedTo).toBe(USER_B)
      expect(payload).not.toHaveProperty('staffId')
      expect(Object.keys(payload).sort()).toEqual([
        'assignedTo',
        'inboxItemId',
        'occurredAt',
        'organizationId',
        'propertyId',
        'source',
        'userId',
      ])
    })

    it('bulk payloads are per-item with oldStatus/newStatus/bulkId', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateRows: [makeItemRow()], outboxRows })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await store.bulkUpdateStatus(
        [makeItem()],
        [
          inboxItemBulkStatusChanged({
            inboxItemId: ITEM_ID,
            organizationId: ORG_ID,
            propertyId: PROP_ID,
            oldStatus: 'open',
            newStatus: 'closed',
            bulkId: 'bulk-1',
            userId: USER_ID,
            occurredAt: NOW,
          }),
        ],
      )

      const payload = outboxRows[0]!.payload as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual([
        'bulkId',
        'inboxItemId',
        'newStatus',
        'occurredAt',
        'oldStatus',
        'organizationId',
        'propertyId',
        'source',
        'userId',
      ])
      expect(payload).not.toHaveProperty('inboxItemIds')
      expect(payload).not.toHaveProperty('previousStatus')
    })
  })
})

describe('createSequentialInboxCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  function makeNoteRepo(): InboxNoteRepository & { notes: InboxNote[] } {
    const notes: InboxNote[] = []
    return {
      notes,
      findByInboxItemId: async (itemId, orgId) =>
        notes.filter((n) => n.inboxItemId === itemId && n.organizationId === orgId),
      create: async (note) => {
        notes.push(note)
        return note
      },
    }
  }

  it('applies state, then records outbox, then emits', async () => {
    const order: string[] = []
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())
    const store = createSequentialInboxCommandStore({
      repo,
      noteRepo: makeNoteRepo(),
      recordOutbox: async () => {
        order.push('outbox')
      },
      events: {
        on: vi.fn(),
        emit: vi.fn(async () => {
          order.push('emit')
        }),
        clear: vi.fn(),
      },
    })

    const result = await store.updateStatus(
      makeItem(),
      { status: 'closed', timestampFields: { closedAt: NOW } },
      statusChangedEvent(),
      NOW,
    )

    expect(result.status).toBe('closed')
    expect(order).toEqual(['outbox', 'emit'])
  })

  it('createItem returns the existing item without a fact on duplicate source', async () => {
    const recordOutbox = vi.fn()
    const emit = vi.fn()
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())
    const store = createSequentialInboxCommandStore({
      repo,
      recordOutbox,
      events: { on: vi.fn(), emit, clear: vi.fn() },
    })

    const result = await store.createItem(
      makeItem({ id: inboxItemId('ii-new') }),
      createdEvent(),
    )

    expect(result.created).toBe(false)
    expect(result.item.id).toBe(ITEM_ID)
    expect(recordOutbox).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('bulkUpdateStatus records and emits per item', async () => {
    const order: string[] = []
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem(), makeItem({ id: inboxItemId('ii-2') }))
    const store = createSequentialInboxCommandStore({
      repo,
      recordOutbox: async () => {
        order.push('outbox')
      },
      events: {
        on: vi.fn(),
        emit: vi.fn(async () => {
          order.push('emit')
        }),
        clear: vi.fn(),
      },
    })

    const items = [makeItem(), makeItem({ id: inboxItemId('ii-2') })]
    const result = await store.bulkUpdateStatus(
      items,
      items.map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: ORG_ID,
          propertyId: item.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          bulkId: 'bulk-1',
          userId: USER_ID,
          occurredAt: NOW,
        }),
      ),
    )

    expect(result).toEqual({ updated: 2 })
    expect(order).toEqual(['outbox', 'emit', 'outbox', 'emit'])
  })

  it('applyReviewCreatedOnce: duplicate source records a duplicate receipt, no fact', async () => {
    const receipts: Array<readonly [string, string, string]> = []
    const recordOutbox = vi.fn()
    const repo = createInMemoryInboxRepo()
    repo.items.push(makeItem())
    const store = createSequentialInboxCommandStore({
      repo,
      recordOutbox,
      recordReceipt: async (eventId, consumerName, status) => {
        receipts.push([eventId, consumerName, status] as const)
      },
      events: { on: vi.fn(), emit: vi.fn(), clear: vi.fn() },
    })

    const outcome = await store.applyReviewCreatedOnce({
      eventId: 'evt-1',
      consumerName: 'inbox.on-review-created',
      item: makeItem({ id: inboxItemId('ii-new') }),
      fact: createdEvent(),
    })

    expect(outcome).toBe('duplicate')
    expect(recordOutbox).not.toHaveBeenCalled()
    expect(receipts).toEqual([['evt-1', 'inbox.on-review-created', 'duplicate']])
  })
})
