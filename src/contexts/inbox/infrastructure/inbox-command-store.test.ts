// BQC-3.4 — atomic inbox command store contract tests.
//
// Every command must commit its state mutation and its outbox_events row in
// ONE transaction, then emit on the in-process bus AFTER commit:
//   ['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit']
// Projection applyOnce commands reserve the consumer receipt before any state
// mutation, then co-commit receipt, state, and fact in the same transaction:
//   ['tx.start', 'tx.receipt', 'tx.state', 'tx.outbox', 'tx.commit', 'emit']
// A lost guarded-transition race commits the receipt only — no fact, no emit.
// A post-commit bus failure must not propagate (durable row already retained).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import type { Database } from '#/shared/db'
import {
  inboxAssignmentHistory,
  inboxHandlingCycleHeads,
  inboxHandlingCycleTransitions,
  inboxHandlingCycles,
  inboxItems,
  inboxNotes,
} from '#/shared/db/schema/inbox.schema'
import { outboxEvents, eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas, validateEventPayload } from '#/shared/events/schema-registry'
import {
  feedbackId,
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
const PROP_ID = propertyId('a0000000-0000-4000-8000-000000000001')
const ITEM_ID = inboxItemId('a0000000-0000-4000-8000-000000000002')
const NOTE_ID = inboxNoteId('a0000000-0000-4000-8000-000000000003')
const REVIEW_ID = reviewId('a0000000-0000-4000-8000-000000000004')
const FEEDBACK_ID = feedbackId('a0000000-0000-4000-8000-000000000005')
const SECOND_ITEM_ID = inboxItemId('a0000000-0000-4000-8000-000000000006')
const SECOND_PROP_ID = propertyId('a0000000-0000-4000-8000-000000000007')
const SECOND_FEEDBACK_ID = feedbackId('a0000000-0000-4000-8000-000000000008')
const USER_ID = userId('user-1')
const USER_B = userId('user-2')
const BULK_REOPEN_GOVERNANCE = {
  reason: 'new_information' as const,
  explanation: null,
}

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

const createAtomicInboxCommandStore = (db: Database, events: EventBus) =>
  createProductionInboxCommandStore(db, events, allowAllCommandAuthority, () => NOW)

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
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeFeedbackItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return makeItem({
    sourceType: 'feedback',
    sourceId: FEEDBACK_ID,
    platform: null,
    ...overrides,
  })
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
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeFeedbackItemRow(overrides: Record<string, unknown> = {}) {
  return makeItemRow({
    sourceType: 'feedback',
    sourceId: FEEDBACK_ID as string,
    platform: null,
    ...overrides,
  })
}

function makeHandlingCycleHeadRow(
  item: InboxItem = makeItem(),
  overrides: Record<string, unknown> = {},
) {
  return {
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    currentCycleNumber: 1,
    currentSourceRevision: 1,
    reviewId: item.sourceType === 'review' ? item.sourceId : null,
    currentMaterialReviewRevision: item.sourceType === 'review' ? 1 : null,
    stateRevision: 1,
    status: item.status,
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
 * `handlingCycleRows` — rows returned when assignment resolves its Review
 *   Handling Cycle anchor.
 * `outboxRows` / `receiptRows` — capture every row sent to outbox_events /
 *   event_consumer_receipts.
 */
function createMockDb(opts: {
  order: string[]
  updateRows?: unknown[]
  updateRowsByCall?: ReadonlyArray<ReadonlyArray<unknown>>
  updateHeadRows?: unknown[]
  insertItemRows?: unknown[]
  selectRows?: unknown[]
  lockedItemRows?: unknown[]
  handlingCycleRows?: unknown[]
  noteRows?: unknown[]
  outboxRows?: Array<Record<string, unknown>>
  receiptRows?: Array<Record<string, unknown>>
  /** Whether an apply-once receipt reservation inserted a new row. */
  receiptReserved?: boolean
  assignmentHistoryRows?: Array<Record<string, unknown>>
  handlingCycleInsertRows?: Array<Record<string, unknown>>
  handlingCycleHeadInsertRows?: Array<Record<string, unknown>>
  handlingCycleTransitionRows?: Array<Record<string, unknown>>
}) {
  const { order } = opts
  let updateCall = 0
  const tx: MockTx = {
    update: vi.fn((table: unknown) => {
      order.push('tx.state')
      const rows =
        table === inboxHandlingCycleHeads
          ? (opts.updateHeadRows ?? [{ id: ITEM_ID, inboxItemId: ITEM_ID }])
          : (opts.updateRowsByCall?.[updateCall] ?? opts.updateRows ?? [])
      if (table !== inboxHandlingCycleHeads) updateCall += 1
      return {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(rows),
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
            onConflictDoNothing: vi.fn(() => {
              const reserved = opts.receiptReserved ?? true
              if (reserved) opts.receiptRows?.push(row)
              return {
                returning: vi
                  .fn()
                  .mockResolvedValue(reserved ? [{ eventId: row.eventId }] : []),
              }
            }),
          })),
        }
      }
      if (table === inboxAssignmentHistory) {
        order.push('tx.state')
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            opts.assignmentHistoryRows?.push(row)
          }),
        }
      }
      if (table === inboxHandlingCycles) {
        order.push('tx.state')
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            opts.handlingCycleInsertRows?.push(row)
          }),
        }
      }
      if (table === inboxHandlingCycleTransitions) {
        order.push('tx.state')
        return {
          values: vi.fn(
            async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
              opts.handlingCycleTransitionRows?.push(
                ...(Array.isArray(rows) ? rows : [rows]),
              )
            },
          ),
        }
      }
      if (table === inboxHandlingCycleHeads) {
        order.push('tx.state')
        return {
          values: vi.fn(async (row: Record<string, unknown>) => {
            opts.handlingCycleHeadInsertRows?.push(row)
          }),
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
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => {
            const rows =
              table === inboxHandlingCycleHeads
                ? (opts.handlingCycleRows ?? [])
                : table === inboxItems && opts.lockedItemRows !== undefined
                  ? opts.lockedItemRows
                  : (opts.selectRows ?? [])
            const query = {
              limit: vi.fn().mockResolvedValue(rows),
              for: vi.fn(),
              orderBy: vi.fn(() => ({
                for: vi.fn().mockResolvedValue(rows),
              })),
            }
            query.for.mockReturnValue(query)
            return query
          }),
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
      const outboxRows: Array<Record<string, unknown>> = []
      const handlingCycleTransitionRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeFeedbackItemRow({ status: 'closed', closedAt: NOW })],
        handlingCycleRows: [makeHandlingCycleHeadRow(makeFeedbackItem())],
        outboxRows,
        handlingCycleTransitionRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.updateStatus(
        makeFeedbackItem(),
        { status: 'closed', timestampFields: { closedAt: NOW } },
        statusChangedEvent(),
        NOW,
      )

      expect(result.status).toBe('closed')
      expect(handlingCycleTransitionRows).toEqual([
        expect.objectContaining({
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          stateRevision: 2,
          kind: 'closed',
          transitionReason: 'private_feedback_handled',
          actorType: 'user',
          actorUserId: USER_ID,
        }),
      ])
      expect(outboxRows.map((row) => row.eventType)).toEqual([
        'inbox.inbox_item.status_changed',
        'inbox.handling_cycle.closed',
      ])
      expect(order[0]).toBe('tx.start')
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.outbox'))
      expect(order.slice(order.indexOf('tx.commit') + 1)).toEqual(['emit', 'emit'])
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
      const { db } = createMockDb({
        order,
        updateRows: [],
        handlingCycleRows: [makeHandlingCycleHeadRow(makeFeedbackItem())],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await expect(
        store.updateStatus(
          makeFeedbackItem(),
          { status: 'closed', timestampFields: { closedAt: NOW } },
          statusChangedEvent(),
          NOW,
        ),
      ).rejects.toSatisfy((e: unknown) => isInboxError(e) && e.code === 'not_found')
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('reports a safe revision conflict and records no fact when another writer won', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [],
        selectRows: [
          {
            commandRevision: 2,
            status: 'closed',
            assignedTo: USER_B,
            isEscalated: false,
            escalationResolvedAt: null,
          },
        ],
        handlingCycleRows: [makeHandlingCycleHeadRow(makeFeedbackItem())],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await expect(
        store.updateStatus(
          makeFeedbackItem(),
          { status: 'closed', timestampFields: { closedAt: NOW } },
          statusChangedEvent(),
          NOW,
        ),
      ).rejects.toSatisfy(
        (error: unknown) =>
          isInboxError(error) &&
          error.code === 'revision_conflict' &&
          error.context?.currentCommandRevision === 2,
      )
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('fails a revoked actor inside the transaction before state or outbox writes', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db, tx } = createMockDb({
        order,
        handlingCycleRows: [makeHandlingCycleHeadRow(makeFeedbackItem())],
        outboxRows,
      })
      const events = makeEvents(order)
      const authorize: InboxCommandAuthority = vi.fn(async () => ({
        allowed: false,
        reason: 'actor_authority_changed',
      }))
      const store = createProductionInboxCommandStore(db, events, authorize, () => NOW)

      await expect(
        store.updateStatus(
          makeFeedbackItem(),
          { status: 'closed', timestampFields: { closedAt: NOW } },
          statusChangedEvent(),
          NOW,
        ),
      ).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'forbidden',
      )
      expect(authorize).toHaveBeenCalledOnce()
      expect(tx.update).not.toHaveBeenCalled()
      expect(tx.insert).not.toHaveBeenCalled()
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })
  })

  describe('reopenReviewCycle', () => {
    it('co-commits governed cycle, head, compatibility projection, and fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const handlingCycleInsertRows: Array<Record<string, unknown>> = []
      const handlingCycleTransitionRows: Array<Record<string, unknown>> = []
      const closedItem = makeItem({
        status: 'closed',
        closedAt: NOW,
        commandRevision: 4,
      })
      const closedItemRow = makeItemRow({
        status: 'closed',
        closedAt: NOW,
        commandRevision: 4,
      })
      const { db } = createMockDb({
        order,
        handlingCycleRows: [
          makeHandlingCycleHeadRow(closedItem, {
            currentCycleNumber: 2,
            currentSourceRevision: 3,
            currentMaterialReviewRevision: 3,
            stateRevision: 7,
            status: 'closed',
          }),
        ],
        selectRows: [closedItemRow],
        updateRows: [makeItemRow({ status: 'open', closedAt: null, commandRevision: 5 })],
        outboxRows,
        handlingCycleInsertRows,
        handlingCycleTransitionRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.reopenReviewCycle({
        item: closedItem,
        expected: {
          cycleNumber: 2,
          materialReviewRevision: 3,
          stateRevision: 7,
        },
        reason: 'other',
        explanation: '  A new guest message needs a response.  ',
        fact: statusChangedEvent('closed'),
        now: NOW,
      })

      expect(result).toMatchObject({ status: 'open', commandRevision: 5 })
      expect(handlingCycleInsertRows).toEqual([
        expect.objectContaining({
          cycleNumber: 3,
          materialReviewRevision: 3,
          openedReason: 'manual_reopen',
          manualReopenReason: 'other',
          manualReopenExplanation: 'A new guest message needs a response.',
          openedBy: USER_ID,
        }),
      ])
      expect(handlingCycleTransitionRows).toEqual([
        expect.objectContaining({
          cycleNumber: 3,
          stateRevision: 8,
          kind: 'reopened',
          transitionReason: 'other',
          actorType: 'user',
          actorUserId: USER_ID,
        }),
      ])
      expect(outboxRows.map((row) => row.eventType)).toEqual([
        'inbox.inbox_item.status_changed',
        'inbox.handling_cycle.reopened',
      ])
      expect(events.emit).toHaveBeenCalledTimes(2)
      expect(order.at(0)).toBe('tx.start')
      expect(order.indexOf('tx.outbox')).toBeLessThan(order.indexOf('tx.commit'))
      expect(order.at(-1)).toBe('emit')
    })

    it('rejects a stale head before appending a cycle or fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const handlingCycleInsertRows: Array<Record<string, unknown>> = []
      const { db, tx } = createMockDb({
        order,
        handlingCycleRows: [
          makeHandlingCycleHeadRow(makeItem(), {
            currentCycleNumber: 3,
            currentSourceRevision: 3,
            currentMaterialReviewRevision: 3,
            stateRevision: 8,
            status: 'open',
          }),
        ],
        selectRows: [makeItemRow({ status: 'open', closedAt: null, commandRevision: 5 })],
        outboxRows,
        handlingCycleInsertRows,
      })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await expect(
        store.reopenReviewCycle({
          item: makeItem({ status: 'closed', closedAt: NOW, commandRevision: 4 }),
          expected: {
            cycleNumber: 2,
            materialReviewRevision: 3,
            stateRevision: 7,
          },
          reason: 'new_information',
          explanation: null,
          fact: statusChangedEvent('closed'),
          now: NOW,
        }),
      ).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'revision_conflict',
      )
      expect(tx.update).not.toHaveBeenCalled()
      expect(handlingCycleInsertRows).toHaveLength(0)
      expect(outboxRows).toHaveLength(0)
    })
  })

  describe('bulkUpdateStatus', () => {
    it('revision-fences N updates + N per-item facts in one tx, then N emits', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const handlingCycleTransitionRows: Array<Record<string, unknown>> = []
      const items = [
        makeFeedbackItem({ status: 'closed' }),
        makeFeedbackItem({
          id: SECOND_ITEM_ID,
          propertyId: SECOND_PROP_ID,
          sourceId: SECOND_FEEDBACK_ID,
          status: 'closed',
        }),
      ]
      const bulkId = 'bulk-1'
      const perItemEvents = items.map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: ORG_ID,
          propertyId: item.propertyId,
          oldStatus: 'closed',
          newStatus: 'open',
          bulkId,
          userId: USER_ID,
          occurredAt: NOW,
        }),
      )
      const { db, tx } = createMockDb({
        order,
        lockedItemRows: [
          makeFeedbackItemRow({ status: 'closed' }),
          makeFeedbackItemRow({
            id: SECOND_ITEM_ID,
            propertyId: SECOND_PROP_ID,
            sourceId: SECOND_FEEDBACK_ID,
            status: 'closed',
          }),
        ],
        handlingCycleRows: items.map((item) =>
          makeHandlingCycleHeadRow(item, { status: 'closed' }),
        ),
        updateRows: [
          makeFeedbackItemRow({ status: 'open', commandRevision: 2 }),
          makeFeedbackItemRow({
            id: SECOND_ITEM_ID,
            propertyId: SECOND_PROP_ID,
            sourceId: SECOND_FEEDBACK_ID,
            status: 'open',
            commandRevision: 2,
          }),
        ],
        outboxRows,
        handlingCycleTransitionRows,
      })
      const events = makeEvents(order)
      const authorize: InboxCommandAuthority = vi.fn(async () => ({
        allowed: true as const,
      }))
      const store = createProductionInboxCommandStore(db, events, authorize, () => NOW)

      const result = await store.bulkUpdateStatus(
        items,
        perItemEvents,
        BULK_REOPEN_GOVERNANCE,
      )

      expect(result).toEqual({
        updated: 2,
        results: [
          { inboxItemId: ITEM_ID, outcome: 'reopened' },
          { inboxItemId: SECOND_ITEM_ID, outcome: 'reopened' },
        ],
      })
      expect(authorize).toHaveBeenCalledOnce()
      expect(authorize).toHaveBeenCalledWith(expect.anything(), {
        organizationId: ORG_ID,
        at: NOW,
        requirements: [
          {
            propertyId: PROP_ID,
            userId: USER_ID,
            permissions: ['inbox.write', 'feedback.handle'],
            purpose: 'actor',
          },
          {
            propertyId: SECOND_PROP_ID,
            userId: USER_ID,
            permissions: ['inbox.write', 'feedback.handle'],
            purpose: 'actor',
          },
        ],
      })
      expect(tx.update).toHaveBeenCalledTimes(4)
      expect(handlingCycleTransitionRows).toEqual([
        expect.objectContaining({
          inboxItemId: ITEM_ID,
          cycleNumber: 2,
          stateRevision: 2,
          kind: 'reopened',
          transitionReason: 'new_information',
          actorType: 'user',
          actorUserId: USER_ID,
        }),
        expect.objectContaining({
          inboxItemId: SECOND_ITEM_ID,
          cycleNumber: 2,
          stateRevision: 2,
          kind: 'reopened',
          transitionReason: 'new_information',
          actorType: 'user',
          actorUserId: USER_ID,
        }),
      ])
      expect(outboxRows.map((row) => row.eventType)).toEqual([
        'inbox.handling_cycle.reopened',
        'inbox.inbox_item.bulk_status_changed',
        'inbox.handling_cycle.reopened',
        'inbox.inbox_item.bulk_status_changed',
      ])
      expect(order[0]).toBe('tx.start')
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.outbox'))
      expect(order.slice(order.indexOf('tx.commit') + 1)).toEqual([
        'emit',
        'emit',
        'emit',
        'emit',
      ])
    })

    it('updates opposite-order batches by item ID but returns caller order', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const first = makeFeedbackItem({ status: 'closed' })
      const second = makeFeedbackItem({
        id: SECOND_ITEM_ID,
        sourceId: SECOND_FEEDBACK_ID,
        status: 'closed',
      })
      const items = [second, first]
      const perItemEvents = items.map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          oldStatus: 'closed',
          newStatus: 'open',
          bulkId: 'bulk-opposite-order',
          userId: USER_ID,
          occurredAt: NOW,
        }),
      )
      const { db } = createMockDb({
        order,
        lockedItemRows: [
          makeFeedbackItemRow({ status: 'closed' }),
          makeFeedbackItemRow({
            id: SECOND_ITEM_ID,
            sourceId: SECOND_FEEDBACK_ID,
            status: 'closed',
          }),
        ],
        handlingCycleRows: [first, second].map((item) =>
          makeHandlingCycleHeadRow(item, { status: 'closed' }),
        ),
        updateRowsByCall: [
          [makeFeedbackItemRow({ id: first.id, status: 'open', commandRevision: 2 })],
          [
            makeFeedbackItemRow({
              id: second.id,
              sourceId: SECOND_FEEDBACK_ID,
              status: 'open',
              commandRevision: 2,
            }),
          ],
        ],
        outboxRows,
      })

      const result = await createAtomicInboxCommandStore(
        db,
        makeEvents(order),
      ).bulkUpdateStatus(items, perItemEvents, BULK_REOPEN_GOVERNANCE)

      expect(result.results).toEqual([
        { inboxItemId: second.id, outcome: 'reopened' },
        { inboxItemId: first.id, outcome: 'reopened' },
      ])
      expect(
        outboxRows
          .filter((row) => row.eventType === 'inbox.inbox_item.bulk_status_changed')
          .map((row) => (row.payload as Record<string, unknown>).inboxItemId),
      ).toEqual([first.id, second.id])
    })

    it('no-ops without a transaction when there are no per-item events', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      const result = await store.bulkUpdateStatus([], [], BULK_REOPEN_GOVERNANCE)

      expect(result).toEqual({ updated: 0, results: [] })
      expect(order).toEqual([])
    })

    it('rejects bulk close before opening a transaction', async () => {
      const order: string[] = []
      const item = makeItem()
      const store = createAtomicInboxCommandStore(
        createMockDb({ order }).db,
        makeEvents(order),
      )

      await expect(
        store.bulkUpdateStatus(
          [item],
          [
            inboxItemBulkStatusChanged({
              inboxItemId: item.id,
              organizationId: item.organizationId,
              propertyId: item.propertyId,
              oldStatus: 'open',
              newStatus: 'closed',
              bulkId: 'bulk-close-disabled',
              userId: USER_ID,
              occurredAt: NOW,
            }),
          ],
          BULK_REOPEN_GOVERNANCE,
        ),
      ).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'invalid_input',
      )
      expect(order).toEqual([])
    })

    it('commits successful rows and reports a racing row without a false fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const secondId = SECOND_ITEM_ID
      const items = [
        makeFeedbackItem({ status: 'closed' }),
        makeFeedbackItem({
          id: secondId,
          sourceId: SECOND_FEEDBACK_ID,
          status: 'closed',
        }),
      ]
      const perItemEvents = items.map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          oldStatus: 'closed',
          newStatus: 'open',
          bulkId: 'bulk-race',
          userId: USER_ID,
          occurredAt: NOW,
        }),
      )
      const { db } = createMockDb({
        order,
        lockedItemRows: [
          makeFeedbackItemRow({ status: 'closed' }),
          makeFeedbackItemRow({
            id: secondId,
            sourceId: SECOND_FEEDBACK_ID,
            status: 'closed',
            commandRevision: 2,
          }),
        ],
        handlingCycleRows: items.map((item) =>
          makeHandlingCycleHeadRow(item, { status: 'closed' }),
        ),
        updateRowsByCall: [[makeFeedbackItemRow({ status: 'open', commandRevision: 2 })]],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.bulkUpdateStatus(
        items,
        perItemEvents,
        BULK_REOPEN_GOVERNANCE,
      )

      expect(result).toEqual({
        updated: 1,
        results: [
          { inboxItemId: ITEM_ID, outcome: 'reopened' },
          { inboxItemId: secondId, outcome: 'revision_conflict' },
        ],
      })
      expect(outboxRows.map((row) => row.eventType)).toEqual([
        'inbox.handling_cycle.reopened',
        'inbox.inbox_item.bulk_status_changed',
      ])
      expect(
        (
          outboxRows.find(
            (row) => row.eventType === 'inbox.inbox_item.bulk_status_changed',
          )!.payload as Record<string, unknown>
        ).inboxItemId,
      ).toBe(ITEM_ID)
      expect(events.emit).toHaveBeenCalledTimes(2)
    })
  })

  describe('bulkAssign', () => {
    it('commits every assignment, per-item facts, history, and one sorted close fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const assignmentHistoryRows: Array<Record<string, unknown>> = []
      const first = makeFeedbackItem({
        id: inboxItemId('00000000-0000-4000-8000-000000000001'),
        sourceId: feedbackId('00000000-0000-4000-8000-000000000011'),
      })
      const second = makeFeedbackItem({
        id: inboxItemId('00000000-0000-4000-8000-000000000002'),
        sourceId: feedbackId('00000000-0000-4000-8000-000000000012'),
        assignedTo: USER_ID,
      })
      const { db, tx } = createMockDb({
        order,
        lockedItemRows: [
          makeFeedbackItemRow({ id: first.id, sourceId: first.sourceId }),
          makeFeedbackItemRow({
            id: second.id,
            sourceId: second.sourceId,
            assignedTo: USER_ID,
          }),
        ],
        handlingCycleRows: [first, second].map((item) => makeHandlingCycleHeadRow(item)),
        updateRowsByCall: [
          [
            makeFeedbackItemRow({
              id: first.id,
              sourceId: first.sourceId,
              assignedTo: USER_B,
              commandRevision: 2,
            }),
          ],
          [
            makeFeedbackItemRow({
              id: second.id,
              sourceId: second.sourceId,
              assignedTo: USER_B,
              commandRevision: 2,
            }),
          ],
        ],
        assignmentHistoryRows,
        outboxRows,
      })
      const authorize: InboxCommandAuthority = vi.fn(async () => ({
        allowed: true as const,
      }))
      const store = createProductionInboxCommandStore(
        db,
        makeEvents(order),
        authorize,
        () => NOW,
      )

      const result = await store.bulkAssign({
        items: [second, first],
        assignedTo: USER_B,
        actorId: USER_ID,
        bulkId: '6a000000-0000-4000-8000-000000000001',
        occurredAt: NOW,
      })

      expect(result).toEqual({
        updated: 2,
        results: [
          { inboxItemId: second.id, outcome: 'reassigned' },
          { inboxItemId: first.id, outcome: 'assigned' },
        ],
      })
      expect(authorize).toHaveBeenCalledOnce()
      expect(tx.update).toHaveBeenCalledTimes(2)
      expect(assignmentHistoryRows).toEqual([
        expect.objectContaining({
          inboxItemId: first.id,
          handlingCycleNumber: 1,
          previousAssignee: null,
          nextAssignee: USER_B,
          reason: 'assign',
          bulkId: '6a000000-0000-4000-8000-000000000001',
        }),
        expect.objectContaining({
          inboxItemId: second.id,
          handlingCycleNumber: 1,
          previousAssignee: USER_ID,
          nextAssignee: USER_B,
          reason: 'reassign',
          bulkId: '6a000000-0000-4000-8000-000000000001',
        }),
      ])
      expect(outboxRows.map((row) => row.eventType)).toEqual([
        'inbox.inbox_item.assigned',
        'inbox.inbox_item.assigned',
        'inbox.inbox_items.bulk_assignment_completed',
      ])
      const completion = outboxRows[2]!.payload as Record<string, unknown>
      expect(completion).toMatchObject({
        bulkId: '6a000000-0000-4000-8000-000000000001',
        count: 2,
        transitions: [
          expect.objectContaining({ inboxItemId: first.id }),
          expect.objectContaining({ inboxItemId: second.id }),
        ],
      })
    })

    it('returns all conflicts and commits nothing when any locked row is stale', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const first = makeFeedbackItem({
        id: inboxItemId('00000000-0000-4000-8000-000000000003'),
      })
      const second = makeFeedbackItem({
        id: inboxItemId('00000000-0000-4000-8000-000000000004'),
        sourceId: feedbackId('00000000-0000-4000-8000-000000000014'),
      })
      const { db, tx } = createMockDb({
        order,
        lockedItemRows: [
          makeFeedbackItemRow({ id: first.id }),
          makeFeedbackItemRow({
            id: second.id,
            sourceId: second.sourceId,
            commandRevision: 2,
          }),
        ],
        handlingCycleRows: [first, second].map((item) => makeHandlingCycleHeadRow(item)),
        outboxRows,
      })
      const authorize: InboxCommandAuthority = vi.fn(async () => ({
        allowed: true as const,
      }))

      await expect(
        createProductionInboxCommandStore(
          db,
          makeEvents(order),
          authorize,
          () => NOW,
        ).bulkAssign({
          items: [first, second],
          assignedTo: USER_B,
          actorId: USER_ID,
          bulkId: '6a000000-0000-4000-8000-000000000002',
          occurredAt: NOW,
        }),
      ).resolves.toEqual({
        updated: 0,
        results: [
          { inboxItemId: first.id, outcome: 'revision_conflict' },
          { inboxItemId: second.id, outcome: 'revision_conflict' },
        ],
      })
      expect(authorize).not.toHaveBeenCalled()
      expect(tx.update).not.toHaveBeenCalled()
      expect(outboxRows).toEqual([])
    })
  })

  describe('assign', () => {
    it('assign path commits update + assigned fact in one tx before emit', async () => {
      const order: string[] = []
      const assignmentHistoryRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ assignedTo: USER_B, commandRevision: 2 })],
        handlingCycleRows: [makeHandlingCycleHeadRow()],
        assignmentHistoryRows,
      })
      const events = makeEvents(order)
      const authorize: InboxCommandAuthority = vi.fn(async () => ({
        allowed: true as const,
      }))
      const store = createProductionInboxCommandStore(db, events, authorize, () => NOW)

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
      expect(authorize).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizationId: ORG_ID,
          requirements: [
            {
              propertyId: PROP_ID,
              userId: USER_ID,
              permissions: ['inbox.write', 'review.read', 'inbox.manage'],
              purpose: 'actor',
            },
            {
              propertyId: PROP_ID,
              userId: USER_B,
              permissions: ['inbox.write', 'review.read'],
              purpose: 'assignee',
            },
          ],
        }),
      )
      expect(assignmentHistoryRows).toEqual([
        expect.objectContaining({
          inboxItemId: ITEM_ID,
          resultingCommandRevision: 2,
          previousAssignee: null,
          nextAssignee: USER_B,
          handlingCycleNumber: 1,
          reason: 'assign',
          actorUserId: USER_ID,
        }),
      ])
      expect(order).toEqual([
        'tx.start',
        'tx.reselect',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('unassign path commits update + unassigned fact in one tx before emit', async () => {
      const order: string[] = []
      const assignmentHistoryRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow()],
        handlingCycleRows: [makeHandlingCycleHeadRow(makeItem({ assignedTo: USER_B }))],
        assignmentHistoryRows,
      })
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

      expect(order).toEqual([
        'tx.start',
        'tx.reselect',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
      expect(assignmentHistoryRows).toEqual([
        expect.objectContaining({
          handlingCycleNumber: 1,
          previousAssignee: USER_B,
          nextAssignee: null,
          reason: 'release',
        }),
      ])
    })

    it('fails closed before mutation when a Review item has no current cycle', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, updateRows: [makeItemRow()] })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await expect(
        store.assign(
          makeItem(),
          { assignedTo: USER_ID },
          inboxItemAssigned({
            inboxItemId: ITEM_ID,
            organizationId: ORG_ID,
            propertyId: PROP_ID,
            userId: USER_ID,
            assignedTo: USER_ID,
            source: 'web',
            occurredAt: NOW,
          }),
          NOW,
        ),
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(order).toEqual(['tx.start', 'tx.reselect'])
    })

    it('anchors a feedback assignment to its current source cycle', async () => {
      const order: string[] = []
      const assignmentHistoryRows: Array<Record<string, unknown>> = []
      const feedbackItem = makeFeedbackItem()
      const { db } = createMockDb({
        order,
        updateRows: [
          makeFeedbackItemRow({
            assignedTo: USER_ID,
            commandRevision: 2,
          }),
        ],
        handlingCycleRows: [makeHandlingCycleHeadRow(feedbackItem)],
        assignmentHistoryRows,
      })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await store.assign(
        feedbackItem,
        { assignedTo: USER_ID },
        inboxItemAssigned({
          inboxItemId: ITEM_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          userId: USER_ID,
          assignedTo: USER_ID,
          source: 'web',
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(order).toEqual([
        'tx.start',
        'tx.reselect',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
      expect(assignmentHistoryRows).toEqual([
        expect.objectContaining({ handlingCycleNumber: 1 }),
      ])
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
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ commandRevision: 2 })],
        noteRows: [makeNoteRow()],
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.addNote(
        makeItem(),
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
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
      ])
    })

    it('rolls back before note and outbox inserts when the item revision is stale', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db, tx } = createMockDb({
        order,
        updateRows: [],
        selectRows: [
          {
            commandRevision: 2,
            status: 'open',
            assignedTo: null,
            isEscalated: false,
            escalationResolvedAt: null,
          },
        ],
        noteRows: [makeNoteRow()],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await expect(
        store.addNote(
          makeItem(),
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
        ),
      ).rejects.toSatisfy(
        (error: unknown) => isInboxError(error) && error.code === 'revision_conflict',
      )
      expect(tx.insert).not.toHaveBeenCalled()
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })
  })

  describe('applySourceCreatedOnce', () => {
    it('commits item + created fact + receipt in one tx before emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const receiptRows: Array<Record<string, unknown>> = []
      const handlingCycleInsertRows: Array<Record<string, unknown>> = []
      const handlingCycleHeadInsertRows: Array<Record<string, unknown>> = []
      const handlingCycleTransitionRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        insertItemRows: [makeItemRow()],
        outboxRows,
        receiptRows,
        handlingCycleInsertRows,
        handlingCycleHeadInsertRows,
        handlingCycleTransitionRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      const outcome = await store.applySourceCreatedOnce({
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
      expect(handlingCycleInsertRows).toEqual([
        expect.objectContaining({
          inboxItemId: ITEM_ID,
          sourceType: 'review',
          sourceId: REVIEW_ID,
          cycleNumber: 1,
          sourceRevision: 1,
          openedReason: 'review_observed',
        }),
      ])
      expect(handlingCycleHeadInsertRows).toEqual([
        expect.objectContaining({
          inboxItemId: ITEM_ID,
          currentCycleNumber: 1,
          currentSourceRevision: 1,
          currentMaterialReviewRevision: 1,
          stateRevision: 1,
          status: 'open',
        }),
      ])
      expect(handlingCycleTransitionRows).toEqual([
        expect.objectContaining({
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          stateRevision: 1,
          kind: 'opened',
          transitionReason: 'review_observed',
          actorType: 'provider',
        }),
      ])
      // Initial Review work is announced by inbox_item.created; the durable
      // cycle/head/transition exists atomically but emits no second opened fact.
      expect(outboxRows.map((row) => row.eventType)).toEqual(['inbox.inbox_item.created'])
      expect(order[0]).toBe('tx.start')
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.state'))
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.outbox'))
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.receipt'))
      expect(order.slice(order.indexOf('tx.commit') + 1)).toEqual(['emit'])
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

      const outcome = await store.applySourceCreatedOnce({
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

  describe('applyReviewUpdatedOnce', () => {
    it('commits metadata refresh + receipt — never a fact, never an emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const receiptRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow()],
        handlingCycleRows: [makeHandlingCycleHeadRow()],
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
      expect(order[0]).toBe('tx.start')
      expect(order).toContain('tx.reselect')
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.state'))
      expect(order.at(-1)).toBe('tx.commit')
    })

    it('does not refresh metadata or advance the item revision on duplicate delivery', async () => {
      const order: string[] = []
      const { db, tx } = createMockDb({
        order,
        updateRows: [makeItemRow({ commandRevision: 2 })],
        receiptReserved: false,
      })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await store.applyReviewUpdatedOnce({
        eventId: 'evt-review-updated-1',
        consumerName: 'inbox.on-review-updated',
        item: makeItem(),
        sourceDate: new Date('2026-05-25'),
        platform: 'google',
        now: NOW,
      })

      expect(tx.update).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.receipt', 'tx.commit'])
    })
  })

  describe('applyReviewSourceTransitionedOnce', () => {
    it('co-commits legacy content scrub, open-item close, fact, and receipt', async () => {
      const order: string[] = []
      const receiptRows: Array<Record<string, unknown>> = []
      const outboxRows: Array<Record<string, unknown>> = []
      const handlingCycleTransitionRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectRows: [
          makeItemRow({
            rating: 1,
            snippet: 'legacy provider text',
            reviewerName: 'Legacy guest',
          }),
        ],
        handlingCycleRows: [makeHandlingCycleHeadRow()],
        updateRows: [{ id: ITEM_ID }],
        receiptRows,
        outboxRows,
        handlingCycleTransitionRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await expect(
        store.applyReviewSourceTransitionedOnce({
          eventId: 'evt-review-source-transitioned-1',
          consumerName: 'inbox.on-review-source-transitioned',
          item: makeItem({
            rating: 1,
            snippet: 'legacy provider text',
            reviewerName: 'Legacy guest',
          }),
          transitionedAt: NOW,
          closeIfOpen: true,
          closeFact: statusChangedEvent(),
        }),
      ).resolves.toBe('applied')

      expect(receiptRows).toHaveLength(1)
      expect(handlingCycleTransitionRows).toEqual([
        expect.objectContaining({
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          stateRevision: 2,
          kind: 'closed',
          transitionReason: 'source_ineligible',
          actorType: 'provider',
          actorUserId: null,
        }),
      ])
      expect(outboxRows.map((row) => row.eventType)).toEqual([
        'inbox.inbox_item.status_changed',
        'inbox.handling_cycle.closed',
      ])
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.state'))
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.outbox'))
      expect(order.slice(order.indexOf('tx.commit') + 1)).toEqual(['emit', 'emit'])
    })

    it('legacy expiry scrubs only and cannot close current work', async () => {
      const order: string[] = []
      const receiptRows: Array<Record<string, unknown>> = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectRows: [
          makeItemRow({
            rating: 1,
            snippet: 'legacy provider text',
            reviewerName: 'Legacy guest',
          }),
        ],
        updateRows: [{ id: ITEM_ID }],
        receiptRows,
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await expect(
        store.applyReviewSourceTransitionedOnce({
          eventId: 'evt-review-expired-legacy-1',
          consumerName: 'inbox.on-review-expired',
          item: makeItem(),
          transitionedAt: NOW,
          closeIfOpen: false,
          closeFact: statusChangedEvent(),
        }),
      ).resolves.toBe('applied')

      expect(receiptRows).toHaveLength(1)
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order[0]).toBe('tx.start')
      expect(order.filter((step) => step === 'tx.reselect')).toHaveLength(2)
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.state'))
      expect(order.at(-1)).toBe('tx.commit')
    })

    it('scrubs an already-closed legacy item without emitting a false status fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        selectRows: [
          makeItemRow({
            status: 'closed',
            closedAt: NOW,
            snippet: 'restored legacy provider text',
          }),
        ],
        handlingCycleRows: [
          makeHandlingCycleHeadRow(makeItem({ status: 'closed', closedAt: NOW }), {
            status: 'closed',
            stateRevision: 2,
          }),
        ],
        updateRows: [{ id: ITEM_ID }],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await store.applyReviewSourceTransitionedOnce({
        eventId: 'evt-review-source-transitioned-1',
        consumerName: 'inbox.on-review-source-transitioned',
        item: makeItem({ status: 'closed', closedAt: NOW }),
        transitionedAt: NOW,
        closeIfOpen: true,
        closeFact: statusChangedEvent(),
      })

      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order[0]).toBe('tx.start')
      expect(order.filter((step) => step === 'tx.reselect')).toHaveLength(2)
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.state'))
      expect(order.at(-1)).toBe('tx.commit')
    })

    it('does no row work for a duplicate transition delivery', async () => {
      const order: string[] = []
      const { db, tx } = createMockDb({ order, receiptReserved: false })
      const events = makeEvents(order)
      const store = createAtomicInboxCommandStore(db, events)

      await store.applyReviewSourceTransitionedOnce({
        eventId: 'evt-review-source-transitioned-1',
        consumerName: 'inbox.on-review-source-transitioned',
        item: makeItem(),
        transitionedAt: NOW,
        closeIfOpen: true,
        closeFact: statusChangedEvent(),
      })

      expect(tx.select).not.toHaveBeenCalled()
      expect(tx.update).not.toHaveBeenCalled()
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.receipt', 'tx.commit'])
    })
  })

  describe('applyReplyPublishedOnce', () => {
    it('records a compatibility receipt without mutating or emitting', async () => {
      const order: string[] = []
      const receiptRows: Array<Record<string, unknown>> = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, receiptRows, outboxRows })
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
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
      expect(order).toEqual(['tx.start', 'tx.receipt', 'tx.commit'])
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
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRows: [makeFeedbackItemRow({ status: 'closed', closedAt: NOW })],
        handlingCycleRows: [makeHandlingCycleHeadRow(makeFeedbackItem())],
        outboxRows,
      })
      const events = makeEvents(order, true)
      const store = createAtomicInboxCommandStore(db, events)

      const result = await store.updateStatus(
        makeFeedbackItem(),
        { status: 'closed', timestampFields: { closedAt: NOW } },
        statusChangedEvent(),
        NOW,
      )

      expect(result.status).toBe('closed')
      expect(outboxRows.map((row) => row.eventType)).toEqual([
        'inbox.inbox_item.status_changed',
        'inbox.handling_cycle.closed',
      ])
      expect(events.emit).toHaveBeenCalledTimes(2)
      expect(order.indexOf('tx.commit')).toBeGreaterThan(order.lastIndexOf('tx.outbox'))
      expect(order.at(-1)).toBe('tx.commit')
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
      const { db } = createMockDb({
        order,
        updateRows: [makeItemRow({ commandRevision: 2 })],
        noteRows: [makeNoteRow()],
        outboxRows,
      })
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
      } as unknown as Parameters<typeof store.addNote>[2]

      await store.addNote(makeItem(), makeNote(), smuggled)

      expect(outboxRows).toHaveLength(1)
      const payload = outboxRows[0]!.payload as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual([
        'correlationId',
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
        handlingCycleRows: [makeHandlingCycleHeadRow()],
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
        'correlationId',
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
      const { db } = createMockDb({
        order,
        lockedItemRows: [makeFeedbackItemRow({ status: 'closed' })],
        handlingCycleRows: [
          makeHandlingCycleHeadRow(makeFeedbackItem({ status: 'closed' }), {
            status: 'closed',
          }),
        ],
        updateRows: [makeFeedbackItemRow({ status: 'open', commandRevision: 2 })],
        outboxRows,
      })
      const store = createAtomicInboxCommandStore(db, makeEvents(order))

      await store.bulkUpdateStatus(
        [makeFeedbackItem({ status: 'closed' })],
        [
          inboxItemBulkStatusChanged({
            inboxItemId: ITEM_ID,
            organizationId: ORG_ID,
            propertyId: PROP_ID,
            oldStatus: 'closed',
            newStatus: 'open',
            bulkId: 'bulk-1',
            userId: USER_ID,
            occurredAt: NOW,
          }),
        ],
        BULK_REOPEN_GOVERNANCE,
      )

      const payload = outboxRows.find(
        (row) => row.eventType === 'inbox.inbox_item.bulk_status_changed',
      )!.payload as Record<string, unknown>
      expect(Object.keys(payload).sort()).toEqual([
        'bulkId',
        'correlationId',
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
    repo.items.push(
      makeItem({ status: 'closed' }),
      makeItem({ id: SECOND_ITEM_ID, status: 'closed' }),
    )
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

    const items = [
      makeItem({ status: 'closed' }),
      makeItem({ id: SECOND_ITEM_ID, status: 'closed' }),
    ]
    const result = await store.bulkUpdateStatus(
      items,
      items.map((item) =>
        inboxItemBulkStatusChanged({
          inboxItemId: item.id,
          organizationId: ORG_ID,
          propertyId: item.propertyId,
          oldStatus: 'closed',
          newStatus: 'open',
          bulkId: 'bulk-1',
          userId: USER_ID,
          occurredAt: NOW,
        }),
      ),
      BULK_REOPEN_GOVERNANCE,
    )

    expect(result).toEqual({
      updated: 2,
      results: [
        { inboxItemId: ITEM_ID, outcome: 'reopened' },
        { inboxItemId: SECOND_ITEM_ID, outcome: 'reopened' },
      ],
    })
    expect(order).toEqual(['outbox', 'emit', 'outbox', 'emit'])
  })

  it('applySourceCreatedOnce: duplicate source records a duplicate receipt, no fact', async () => {
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

    const outcome = await store.applySourceCreatedOnce({
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
