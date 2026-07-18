// BQC-3.3 — atomic reply command store contract tests.
// BQC-3.8 — persisted publication state machine transitions.
//
// Every command must commit its state mutation and its outbox_events row in
// ONE transaction, then emit on the in-process bus AFTER commit:
//   ['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit']
// A lost guarded-transition race (no row matched) commits nothing and emits
// nothing: ['tx.start', 'tx.state', 'tx.commit'].
// A post-commit bus failure must not propagate (durable row already retained).
//
// BQC-3.8 publication commands additionally:
//   - pre-check the transition against the domain authority
//     (nextPublicationState) — an impossible transition returns null WITHOUT
//     touching the DB;
//   - guard the SQL write on BOTH status and publication_state, so a lost
//     TOCTOU race (cancellation, racing claim, purge) records no fact;
//   - claim/requeue are single guarded UPDATEs (no tx — no fact to commit).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAtomicReplyCommandStore,
  createSequentialReplyCommandStore,
} from './reply-command-store'
import type { Database } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { Reply } from '../domain/types'
import {
  reviewExpired,
  reviewReplyApproved,
  reviewReplyPublicationCancelled,
  reviewReplyPublished,
  reviewReplyPublishFailed,
  reviewReplyRejected,
  reviewReplySubmitted,
} from '../domain/events'
import { AMBIGUOUS_RECONCILE_DELAY_MS } from '../domain/reply-publication-workflow'

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

const NOW = new Date('2025-06-01T12:00:00.000Z')
const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const REVIEW_ID = reviewId('rev-1')
const REPLY_ID = replyId('reply-1')
const USER_ID = userId('user-1')

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: REPLY_ID,
    reviewId: REVIEW_ID,
    organizationId: ORG_ID,
    text: 'Thank you!',
    status: 'draft',
    source: 'internal',
    createdBy: USER_ID,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

/** DB row shape as drizzle returns it (camelCase keys, timestamps present). */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPLY_ID,
    reviewId: REVIEW_ID,
    organizationId: ORG_ID,
    text: 'Thank you!',
    status: 'pending_approval',
    source: 'internal',
    createdBy: USER_ID,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: NOW,
    approvedAt: null,
    publishedAt: null,
    publicationState: null,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

type MockTx = {
  update: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

/**
 * Mocked drizzle transaction recording the crash-boundary ordering.
 * `updateRowsQueue` — rows returned by each guarded UPDATE ... RETURNING, one
 * entry per update call in order ([] = lost race; missing entry = []).
 * `upsertRows` — rows returned by mirror INSERT ... ON CONFLICT ... RETURNING.
 * `outboxRows` — captures every values() payload sent to outbox_events.
 * `setPayloads` — captures every .set() payload (publication state assertions).
 */
function createMockDb(opts: {
  order: string[]
  updateRowsQueue?: unknown[][]
  upsertRows?: unknown[]
  outboxRows?: Array<Record<string, unknown>>
  setPayloads?: Array<Record<string, unknown>>
}) {
  const { order } = opts
  const queue = [...(opts.updateRowsQueue ?? [])]
  const nextRows = () => queue.shift() ?? []
  const updateRecorder = (marker: string) =>
    (() => {
      order.push(marker)
      return {
        set: vi.fn((payload: Record<string, unknown>) => {
          opts.setPayloads?.push(payload)
          return {
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue(nextRows()),
            })),
          }
        }),
      }
    }) as unknown as MockTx['update']
  const tx: MockTx = {
    update: updateRecorder('tx.state'),
    delete: vi.fn(() => {
      order.push('tx.state')
      return { where: vi.fn().mockResolvedValue(undefined) }
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
      order.push('tx.state')
      return {
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue(opts.upsertRows ?? []),
          })),
        })),
      }
    }),
  }
  const db = {
    // BQC-3.8: claim/requeue run as single guarded UPDATEs outside a tx.
    update: updateRecorder('db.state'),
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

const submittedEvent = () =>
  reviewReplySubmitted({
    replyId: REPLY_ID,
    reviewId: REVIEW_ID,
    propertyId: PROP_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    occurredAt: NOW,
  })

const approvedEvent = () =>
  reviewReplyApproved({
    replyId: REPLY_ID,
    reviewId: REVIEW_ID,
    propertyId: PROP_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    authorId: USER_ID,
    occurredAt: NOW,
  })

const publishedEvent = () =>
  reviewReplyPublished({
    replyId: REPLY_ID,
    reviewId: REVIEW_ID,
    propertyId: PROP_ID,
    organizationId: ORG_ID,
    userId: null,
    authorId: USER_ID,
    occurredAt: NOW,
  })

const publishFailedEvent = () =>
  reviewReplyPublishFailed({
    replyId: REPLY_ID,
    reviewId: REVIEW_ID,
    propertyId: PROP_ID,
    organizationId: ORG_ID,
    authorId: USER_ID,
    occurredAt: NOW,
  })

const cancelledEvent = () =>
  reviewReplyPublicationCancelled({
    replyId: REPLY_ID,
    reviewId: REVIEW_ID,
    propertyId: PROP_ID,
    organizationId: ORG_ID,
    cause: 'disconnect',
    occurredAt: NOW,
  })

/** An approved reply mid-publication (claimed by the publish job). */
const sendingReply = () =>
  makeReply({ status: 'approved', publicationState: 'sending', publicationAttempts: 1 })

describe('createAtomicReplyCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('guarded transition commands', () => {
    it('submitReply runs guarded update + outbox insert in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, updateRowsQueue: [[makeRow()]] })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.submitReply(
        makeReply({ status: 'draft' }),
        { status: 'pending_approval', submittedAt: NOW },
        submittedEvent(),
        NOW,
      )

      expect(result?.status).toBe('pending_approval')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('rejectReply commits update + outbox + emit in order', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [[makeRow({ status: 'rejected', rejectedBy: USER_ID })]],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      await store.rejectReply(
        makeReply({ status: 'pending_approval' }),
        { status: 'rejected', rejectedBy: USER_ID, rejectionReason: 'Tone' },
        reviewReplyRejected({
          replyId: REPLY_ID,
          reviewId: REVIEW_ID,
          propertyId: PROP_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
          authorId: USER_ID,
          reason: 'Tone',
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('markPublished commits update + outbox + emit in order and sets publication_state=published', async () => {
      const order: string[] = []
      const setPayloads: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [
            makeRow({
              status: 'published',
              publishedAt: NOW,
              publicationState: 'published',
            }),
          ],
        ],
        setPayloads,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      await store.markPublished(
        sendingReply(),
        { status: 'published', publishedAt: NOW },
        publishedEvent(),
        NOW,
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
      // BQC-3.8: provider confirmation persists publication_state='published'
      // and clears the reconcile schedule.
      expect(setPayloads[0]).toMatchObject({
        publicationState: 'published',
        reconcileDueAt: null,
      })
    })

    it('lost race (guard matches no row) returns null — no outbox row, no emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.submitReply(
        makeReply({ status: 'draft' }),
        { status: 'pending_approval', submittedAt: NOW },
        submittedEvent(),
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('emit failure after commit does not propagate (durable row retained)', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, updateRowsQueue: [[makeRow()]] })
      const events = makeEvents(order, true)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.submitReply(
        makeReply({ status: 'draft' }),
        { status: 'pending_approval', submittedAt: NOW },
        submittedEvent(),
        NOW,
      )

      expect(result?.status).toBe('pending_approval')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit'])
    })
  })

  describe('markPublicationAuthorized (BQC-3.8)', () => {
    it('approval: commits status + authorized state + cycle reset + approved fact, one tx', async () => {
      const order: string[] = []
      const setPayloads: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [
            makeRow({
              status: 'approved',
              approvedAt: NOW,
              approvedBy: USER_ID,
              publicationState: 'authorized',
            }),
          ],
        ],
        setPayloads,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationAuthorized(
        makeReply({ status: 'pending_approval' }),
        { status: 'approved', approvedBy: USER_ID, approvedAt: NOW },
        approvedEvent(),
        NOW,
      )

      expect(result?.status).toBe('approved')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
      expect(setPayloads[0]).toMatchObject({
        publicationState: 'authorized',
        publicationAttempts: 0,
        publicationLastErrorClass: null,
        reconcileDueAt: null,
      })
    })

    it('retry re-authorization (publish_failed + terminal state): no fact, no emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [makeRow({ status: 'approved', publicationState: 'authorized' })],
        ],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationAuthorized(
        makeReply({
          status: 'publish_failed',
          publicationState: 'terminal',
          publicationLastErrorClass: 'terminal_rejection',
        }),
        { status: 'approved' },
        null,
        NOW,
      )

      expect(result?.publicationState).toBe('authorized')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('impossible transition (already published) returns null WITHOUT touching the DB', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const store = createAtomicReplyCommandStore(db, makeEvents(order))

      const result = await store.markPublicationAuthorized(
        makeReply({ status: 'published', publicationState: 'published' }),
        { status: 'approved' },
        null,
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual([])
    })

    it('lost race returns null — no outbox, no emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationAuthorized(
        makeReply({ status: 'pending_approval' }),
        { status: 'approved' },
        approvedEvent(),
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(events.emit).not.toHaveBeenCalled()
    })
  })

  describe('markPublicationSending (BQC-3.8 claim)', () => {
    it('claim hit: single guarded UPDATE → sending, attempts+1, NO fact/emit/tx', async () => {
      const order: string[] = []
      const setPayloads: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [
            makeRow({
              status: 'approved',
              publicationState: 'sending',
              publicationAttempts: 1,
            }),
          ],
        ],
        setPayloads,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationSending(
        makeReply({ status: 'approved', publicationState: 'authorized' }),
        NOW,
      )

      expect(result?.publicationState).toBe('sending')
      expect(order).toEqual(['db.state'])
      expect(setPayloads[0]).toMatchObject({ publicationState: 'sending' })
      // attempts+1 is an atomic SQL fragment, not a caller-computed value.
      expect(typeof setPayloads[0]!.publicationAttempts).not.toBe('number')
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('sending → sending re-claim is allowed (same job retrying an ambiguous attempt)', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [
            makeRow({
              status: 'approved',
              publicationState: 'sending',
              publicationAttempts: 2,
            }),
          ],
        ],
      })
      const store = createAtomicReplyCommandStore(db, makeEvents(order))

      const result = await store.markPublicationSending(sendingReply(), NOW)

      expect(result?.publicationAttempts).toBe(2)
      expect(order).toEqual(['db.state'])
    })

    it('guard miss (cancelled/racing) returns null — no write, no fact', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationSending(
        makeReply({ status: 'approved', publicationState: 'authorized' }),
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual(['db.state'])
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('cancelled row cannot be claimed — domain pre-check returns null without DB', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const store = createAtomicReplyCommandStore(db, makeEvents(order))

      const result = await store.markPublicationSending(
        makeReply({ status: 'draft', publicationState: 'cancelled' }),
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual([])
    })
  })

  describe('markPublicationTerminal (BQC-3.8)', () => {
    it('commits publish_failed + terminal + error class + fact in one tx before emit', async () => {
      const order: string[] = []
      const setPayloads: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [
            makeRow({
              status: 'publish_failed',
              publicationState: 'terminal',
              publicationLastErrorClass: 'terminal_rejection',
            }),
          ],
        ],
        setPayloads,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationTerminal(
        sendingReply(),
        'terminal_rejection',
        publishFailedEvent(),
        NOW,
      )

      expect(result?.status).toBe('publish_failed')
      expect(result?.publicationState).toBe('terminal')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
      expect(setPayloads[0]).toMatchObject({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'terminal_rejection',
      })
    })

    it('null event commits the state only (fact-less tolerate path)', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [makeRow({ status: 'publish_failed', publicationState: 'terminal' })],
        ],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationTerminal(
        sendingReply(),
        'terminal_rejection',
        null,
        NOW,
      )

      expect(result?.publicationState).toBe('terminal')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('guard miss (row no longer sending) returns null — no fact', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, outboxRows })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationTerminal(
        sendingReply(),
        'terminal_rejection',
        publishFailedEvent(),
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(outboxRows).toHaveLength(0)
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('non-sending state (authorized) is rejected by the domain pre-check — no DB write', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const store = createAtomicReplyCommandStore(db, makeEvents(order))

      const result = await store.markPublicationTerminal(
        makeReply({ status: 'approved', publicationState: 'authorized' }),
        'terminal_rejection',
        publishFailedEvent(),
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual([])
    })
  })

  describe('markPublicationAmbiguous (BQC-3.8)', () => {
    it('commits publish_failed + ambiguous + reconcile_due_at (now + 15min) + fact in one tx', async () => {
      const order: string[] = []
      const setPayloads: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [
            makeRow({
              status: 'publish_failed',
              publicationState: 'ambiguous',
              publicationLastErrorClass: 'ambiguous',
              reconcileDueAt: new Date(NOW.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS),
            }),
          ],
        ],
        setPayloads,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationAmbiguous(
        sendingReply(),
        publishFailedEvent(),
        NOW,
      )

      expect(result?.publicationState).toBe('ambiguous')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
      expect(setPayloads[0]).toMatchObject({
        status: 'publish_failed',
        publicationState: 'ambiguous',
        publicationLastErrorClass: 'ambiguous',
        reconcileDueAt: new Date(NOW.getTime() + AMBIGUOUS_RECONCILE_DELAY_MS),
      })
      // The sweep finds the row by this exact schedule.
      expect(AMBIGUOUS_RECONCILE_DELAY_MS).toBe(15 * 60 * 1000)
    })

    it('guard miss returns null — no fact', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationAmbiguous(
        sendingReply(),
        publishFailedEvent(),
        NOW,
      )

      expect(result).toBeNull()
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(events.emit).not.toHaveBeenCalled()
    })
  })

  describe('markPublicationRetryQueued (BQC-3.8)', () => {
    it('sending → authorized single guarded UPDATE, class/attempts preserved, no fact', async () => {
      const order: string[] = []
      const setPayloads: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [makeRow({ status: 'approved', publicationState: 'authorized' })],
        ],
        setPayloads,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublicationRetryQueued(sendingReply(), NOW)

      expect(result?.publicationState).toBe('authorized')
      expect(order).toEqual(['db.state'])
      expect(setPayloads[0]).toMatchObject({ publicationState: 'authorized' })
      // last_error_class / attempts deliberately NOT in the set clause.
      expect(setPayloads[0]).not.toHaveProperty('publicationLastErrorClass')
      expect(setPayloads[0]).not.toHaveProperty('publicationAttempts')
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('guard miss returns null', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const store = createAtomicReplyCommandStore(db, makeEvents(order))

      const result = await store.markPublicationRetryQueued(sendingReply(), NOW)

      expect(result).toBeNull()
      expect(order).toEqual(['db.state'])
    })
  })

  describe('cancelPublications (BQC-3.8)', () => {
    it('cancels each active reply in ONE batch tx: state write + fact per row, emits after commit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const setPayloads: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        updateRowsQueue: [
          [makeRow({ status: 'draft', publicationState: 'cancelled' })],
          [makeRow({ status: 'draft', publicationState: 'cancelled' })],
        ],
        outboxRows,
        setPayloads,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const count = await store.cancelPublications([
        {
          reply: makeReply({ status: 'approved', publicationState: 'authorized' }),
          event: cancelledEvent(),
          now: NOW,
        },
        { reply: sendingReply(), event: cancelledEvent(), now: NOW },
      ])

      expect(count).toBe(2)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.state',
        'tx.outbox',
        'tx.commit',
        'emit',
        'emit',
      ])
      expect(outboxRows).toHaveLength(2)
      expect((outboxRows[0]!.payload as { cause?: string }).cause).toBe('disconnect')
      for (const set of setPayloads) {
        expect(set).toMatchObject({ status: 'draft', publicationState: 'cancelled' })
      }
    })

    it('rows whose state moved on are skipped without a fact — the batch still commits', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({
        order,
        // First command hits, second misses the guard (purged/published meanwhile).
        updateRowsQueue: [
          [makeRow({ status: 'draft', publicationState: 'cancelled' })],
          [],
        ],
        outboxRows,
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const count = await store.cancelPublications([
        {
          reply: makeReply({ status: 'approved', publicationState: 'authorized' }),
          event: cancelledEvent(),
          now: NOW,
        },
        { reply: sendingReply(), event: cancelledEvent(), now: NOW },
      ])

      expect(count).toBe(1)
      expect(order).toEqual([
        'tx.start',
        'tx.state',
        'tx.outbox',
        'tx.state',
        'tx.commit',
        'emit',
      ])
      expect(outboxRows).toHaveLength(1)
    })

    it('a publication already terminal/published is skipped by the domain pre-check — no DB write for that row', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const count = await store.cancelPublications([
        {
          reply: makeReply({ status: 'published', publicationState: 'published' }),
          event: cancelledEvent(),
          now: NOW,
        },
      ])

      expect(count).toBe(0)
      expect(order).toEqual(['tx.start', 'tx.commit'])
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('empty batch is a no-op (no tx)', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const store = createAtomicReplyCommandStore(db, makeEvents(order))

      expect(await store.cancelPublications([])).toBe(0)
      expect(order).toEqual([])
    })
  })

  describe('mirrorSyncedReply', () => {
    it('new google_sync reply: upsert + published fact in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        upsertRows: [makeRow({ source: 'google_sync', status: 'published' })],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const mirrored = makeReply({ source: 'google_sync', status: 'published' })
      const { createdAt: _c, updatedAt: _u, ...replyInput } = mirrored
      const result = await store.mirrorSyncedReply({
        reply: replyInput,
        reviewId: REVIEW_ID,
        organizationId: ORG_ID,
        event: reviewReplyPublished({
          source: 'import',
          authorId: null,
          userId: null,
          replyId: REPLY_ID,
          reviewId: REVIEW_ID,
          organizationId: ORG_ID,
          propertyId: PROP_ID,
          occurredAt: NOW,
        }),
        now: NOW,
      })

      expect(result?.status).toBe('published')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('existing google_sync reply refresh: upsert only (no fact, no emit)', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        upsertRows: [makeRow({ source: 'google_sync', status: 'published' })],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const mirrored = makeReply({ source: 'google_sync', status: 'published' })
      const { createdAt: _c, updatedAt: _u, ...replyInput } = mirrored
      const result = await store.mirrorSyncedReply({
        reply: replyInput,
        reviewId: REVIEW_ID,
        organizationId: ORG_ID,
        event: null,
        now: NOW,
      })

      expect(result?.status).toBe('published')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(events.emit).not.toHaveBeenCalled()
    })

    it('mirror delete path: delete only — never emits a fact', async () => {
      const order: string[] = []
      const { db, tx } = createMockDb({ order })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.mirrorSyncedReply({
        reply: null,
        reviewId: REVIEW_ID,
        organizationId: ORG_ID,
        event: null,
        now: NOW,
      })

      expect(result).toBeNull()
      expect(tx.delete).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
      expect(events.emit).not.toHaveBeenCalled()
    })
  })

  describe('purgeExpiredReview', () => {
    it('deletes the review and records review.expired in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      await store.purgeExpiredReview(
        REVIEW_ID,
        reviewExpired({
          reviewId: REVIEW_ID,
          propertyId: PROP_ID,
          organizationId: ORG_ID,
          occurredAt: NOW,
        }),
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })
  })

  describe('identifier-only payload enforcement (schema allowlist)', () => {
    it('smuggled content fields never reach the outbox row (reply events)', async () => {
      const cases: ReadonlyArray<{
        tag: string
        event: DomainEvent
        expectedKeys: string[]
      }> = [
        {
          tag: 'review.reply.submitted',
          event: submittedEvent(),
          expectedKeys: [
            'correlationId',
            'occurredAt',
            'organizationId',
            'propertyId',
            'replyId',
            'reviewId',
            'source',
            'userId',
          ],
        },
        {
          tag: 'review.reply.approved',
          event: approvedEvent(),
          expectedKeys: [
            'authorId',
            'correlationId',
            'occurredAt',
            'organizationId',
            'propertyId',
            'replyId',
            'reviewId',
            'source',
            'userId',
          ],
        },
        {
          tag: 'review.reply.rejected',
          event: reviewReplyRejected({
            replyId: REPLY_ID,
            reviewId: REVIEW_ID,
            propertyId: PROP_ID,
            organizationId: ORG_ID,
            userId: USER_ID,
            authorId: USER_ID,
            reason: 'content that must be stripped',
            occurredAt: NOW,
          }),
          expectedKeys: [
            'authorId',
            'correlationId',
            'occurredAt',
            'organizationId',
            'propertyId',
            'replyId',
            'reviewId',
            'source',
            'userId',
          ],
        },
        {
          tag: 'review.reply.published',
          event: publishedEvent(),
          expectedKeys: [
            'authorId',
            'correlationId',
            'occurredAt',
            'organizationId',
            'propertyId',
            'replyId',
            'reviewId',
            'source',
            'userId',
          ],
        },
        {
          tag: 'review.reply.publish_failed',
          event: publishFailedEvent(),
          expectedKeys: [
            'authorId',
            'correlationId',
            'occurredAt',
            'organizationId',
            'propertyId',
            'replyId',
            'reviewId',
          ],
        },
        {
          // BQC-3.8: identifier-only cancellation fact (cause is an enum).
          tag: 'review.reply.publication_cancelled',
          event: cancelledEvent(),
          expectedKeys: [
            'cause',
            'correlationId',
            'occurredAt',
            'organizationId',
            'propertyId',
            'replyId',
            'reviewId',
          ],
        },
      ]

      for (const { tag, event, expectedKeys } of cases) {
        const order: string[] = []
        const outboxRows: Array<Record<string, unknown>> = []
        const { db } = createMockDb({ order, updateRowsQueue: [[makeRow()]], outboxRows })
        const store = createAtomicReplyCommandStore(db, makeEvents(order))

        // Smuggle content fields onto the event — denylist strip + schema
        // allowlist must drop them before insert.
        const smuggled = {
          ...event,
          text: 'raw reply text',
          reviewerName: 'Jane Doe',
          reason: 'rejection prose',
        } as unknown as Parameters<typeof store.submitReply>[2]

        await store.submitReply(
          makeReply({ status: 'draft' }),
          { status: 'pending_approval', submittedAt: NOW },
          smuggled,
          NOW,
        )

        expect(outboxRows, `expected outbox row for ${tag}`).toHaveLength(1)
        const payload = outboxRows[0]!.payload as Record<string, unknown>
        expect(Object.keys(payload).sort(), `payload keys for ${tag}`).toEqual(
          expectedKeys,
        )
      }
    })
  })
})

describe('createSequentialReplyCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('applies the guarded update, then records outbox, then emits', async () => {
    const order: string[] = []
    const updated = makeReply({ status: 'pending_approval', submittedAt: NOW })
    const store = createSequentialReplyCommandStore({
      conditionalUpdate: vi.fn(async () => {
        order.push('state')
        return updated
      }),
      upsert: vi.fn(),
      deleteByReviewIdAndSource: vi.fn(),
      deleteReviewById: vi.fn(),
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

    const result = await store.submitReply(
      makeReply({ status: 'draft' }),
      { status: 'pending_approval', submittedAt: NOW },
      submittedEvent(),
      NOW,
    )

    expect(result).toEqual(updated)
    expect(order).toEqual(['state', 'outbox', 'emit'])
  })

  it('markPublicationAuthorized returns null and skips outbox/emit when the guard loses the race', async () => {
    const recordOutbox = vi.fn()
    const emit = vi.fn()
    const store = createSequentialReplyCommandStore({
      conditionalUpdate: vi.fn(async () => null),
      upsert: vi.fn(),
      deleteByReviewIdAndSource: vi.fn(),
      deleteReviewById: vi.fn(),
      recordOutbox,
      events: { on: vi.fn(), emit, clear: vi.fn() },
    })

    const result = await store.markPublicationAuthorized(
      makeReply({ status: 'pending_approval' }),
      { status: 'approved' },
      approvedEvent(),
      NOW,
    )

    expect(result).toBeNull()
    expect(recordOutbox).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  it('markPublicationSending routes through publicationUpdate with the sending claim', async () => {
    const publicationUpdate = vi.fn(async (reply: Reply) => ({
      ...reply,
      publicationState: 'sending' as const,
    }))
    const store = createSequentialReplyCommandStore({
      conditionalUpdate: vi.fn(),
      upsert: vi.fn(),
      deleteByReviewIdAndSource: vi.fn(),
      deleteReviewById: vi.fn(),
      publicationUpdate,
      events: { on: vi.fn(), emit: vi.fn(), clear: vi.fn() },
    })

    const result = await store.markPublicationSending(
      makeReply({ status: 'approved', publicationState: 'authorized' }),
      NOW,
    )

    expect(result?.publicationState).toBe('sending')
    expect(publicationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ publicationState: 'authorized' }),
      ['authorized', 'sending'],
      expect.objectContaining({ publicationState: 'sending' }),
      NOW,
    )
  })

  it('publication transitions fail closed when publicationUpdate is not wired', async () => {
    const store = createSequentialReplyCommandStore({
      conditionalUpdate: vi.fn(),
      upsert: vi.fn(),
      deleteByReviewIdAndSource: vi.fn(),
      deleteReviewById: vi.fn(),
      events: { on: vi.fn(), emit: vi.fn(), clear: vi.fn() },
    })

    await expect(
      store.markPublicationSending(
        makeReply({ status: 'approved', publicationState: 'authorized' }),
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'build_config_error' })
  })

  it('cancelPublications records + emits one fact per cancelled row, skips guard misses', async () => {
    const order: string[] = []
    const recordOutbox = vi.fn(async () => {
      order.push('outbox')
    })
    const emit = vi.fn(async () => {
      order.push('emit')
    })
    const publicationUpdate = vi.fn(async (reply: Reply) => {
      order.push('state')
      // The second reply loses the race (published meanwhile).
      return reply.publicationState === 'sending'
        ? null
        : { ...reply, status: 'draft' as const, publicationState: 'cancelled' as const }
    })
    const store = createSequentialReplyCommandStore({
      conditionalUpdate: vi.fn(),
      upsert: vi.fn(),
      deleteByReviewIdAndSource: vi.fn(),
      deleteReviewById: vi.fn(),
      publicationUpdate,
      recordOutbox,
      events: { on: vi.fn(), emit, clear: vi.fn() },
    })

    const count = await store.cancelPublications([
      {
        reply: makeReply({ status: 'approved', publicationState: 'authorized' }),
        event: cancelledEvent(),
        now: NOW,
      },
      { reply: sendingReply(), event: cancelledEvent(), now: NOW },
    ])

    expect(count).toBe(1)
    expect(order).toEqual(['state', 'outbox', 'emit', 'state'])
  })

  it('purgeExpiredReview deletes, records, then emits', async () => {
    const order: string[] = []
    const store = createSequentialReplyCommandStore({
      conditionalUpdate: vi.fn(),
      upsert: vi.fn(),
      deleteByReviewIdAndSource: vi.fn(),
      deleteReviewById: vi.fn(async () => {
        order.push('state')
      }),
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

    await store.purgeExpiredReview(
      REVIEW_ID,
      reviewExpired({
        reviewId: REVIEW_ID,
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        occurredAt: NOW,
      }),
    )

    expect(order).toEqual(['state', 'outbox', 'emit'])
  })
})
