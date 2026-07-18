// BQC-3.3 — atomic reply command store contract tests.
//
// Every command must commit its state mutation and its outbox_events row in
// ONE transaction, then emit on the in-process bus AFTER commit:
//   ['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit']
// A lost guarded-transition race (no row matched) commits nothing and emits
// nothing: ['tx.start', 'tx.state', 'tx.commit'].
// A post-commit bus failure must not propagate (durable row already retained).

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
  reviewReplyPublished,
  reviewReplyPublishFailed,
  reviewReplyRejected,
  reviewReplySubmitted,
} from '../domain/events'

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
 * `updateRows` — rows returned by guarded UPDATE ... RETURNING ([] = lost race).
 * `upsertRows` — rows returned by mirror INSERT ... ON CONFLICT ... RETURNING.
 * `outboxRows` — captures every values() payload sent to outbox_events.
 */
function createMockDb(opts: {
  order: string[]
  updateRows?: unknown[]
  upsertRows?: unknown[]
  outboxRows?: Array<Record<string, unknown>>
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

describe('createAtomicReplyCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  describe('guarded transition commands', () => {
    it('submitReply runs guarded update + outbox insert in one tx before emit', async () => {
      const order: string[] = []
      const { db } = createMockDb({ order, updateRows: [makeRow()] })
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

    it('approveReply commits update + outbox + emit in order', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [
          makeRow({ status: 'approved', approvedAt: NOW, approvedBy: USER_ID }),
        ],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.approveReply(
        makeReply({ status: 'pending_approval' }),
        { status: 'approved', approvedBy: USER_ID, approvedAt: NOW },
        reviewReplyApproved({
          replyId: REPLY_ID,
          reviewId: REVIEW_ID,
          propertyId: PROP_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
          authorId: USER_ID,
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(result?.status).toBe('approved')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('rejectReply commits update + outbox + emit in order', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeRow({ status: 'rejected', rejectedBy: USER_ID })],
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

    it('markPublished commits update + outbox + emit in order', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeRow({ status: 'published', publishedAt: NOW })],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      await store.markPublished(
        makeReply({ status: 'approved' }),
        { status: 'published', publishedAt: NOW },
        reviewReplyPublished({
          replyId: REPLY_ID,
          reviewId: REVIEW_ID,
          propertyId: PROP_ID,
          organizationId: ORG_ID,
          userId: null,
          authorId: USER_ID,
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('markPublishFailed commits update + outbox + emit in order', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeRow({ status: 'publish_failed' })],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      await store.markPublishFailed(
        makeReply({ status: 'approved' }),
        { status: 'publish_failed' },
        reviewReplyPublishFailed({
          replyId: REPLY_ID,
          reviewId: REVIEW_ID,
          propertyId: PROP_ID,
          organizationId: ORG_ID,
          authorId: USER_ID,
          occurredAt: NOW,
        }),
        NOW,
      )

      expect(order).toEqual(['tx.start', 'tx.state', 'tx.outbox', 'tx.commit', 'emit'])
    })

    it('markPublishFailed with null event commits update only (no outbox, no emit)', async () => {
      const order: string[] = []
      const { db } = createMockDb({
        order,
        updateRows: [makeRow({ status: 'publish_failed' })],
      })
      const events = makeEvents(order)
      const store = createAtomicReplyCommandStore(db, events)

      const result = await store.markPublishFailed(
        makeReply({ status: 'approved' }),
        { status: 'publish_failed' },
        null,
        NOW,
      )

      expect(result?.status).toBe('publish_failed')
      expect(order).toEqual(['tx.start', 'tx.state', 'tx.commit'])
    })

    it('lost race (guard matches no row) returns null — no outbox row, no emit', async () => {
      const order: string[] = []
      const outboxRows: Array<Record<string, unknown>> = []
      const { db } = createMockDb({ order, updateRows: [], outboxRows })
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
      const { db } = createMockDb({ order, updateRows: [makeRow()] })
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
          event: reviewReplyApproved({
            replyId: REPLY_ID,
            reviewId: REVIEW_ID,
            propertyId: PROP_ID,
            organizationId: ORG_ID,
            userId: USER_ID,
            authorId: USER_ID,
            occurredAt: NOW,
          }),
          expectedKeys: [
            'authorId',
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
          event: reviewReplyPublished({
            replyId: REPLY_ID,
            reviewId: REVIEW_ID,
            propertyId: PROP_ID,
            organizationId: ORG_ID,
            userId: null,
            authorId: USER_ID,
            occurredAt: NOW,
          }),
          expectedKeys: [
            'authorId',
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
          event: reviewReplyPublishFailed({
            replyId: REPLY_ID,
            reviewId: REVIEW_ID,
            propertyId: PROP_ID,
            organizationId: ORG_ID,
            authorId: USER_ID,
            occurredAt: NOW,
          }),
          expectedKeys: [
            'authorId',
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
        const { db } = createMockDb({ order, updateRows: [makeRow()], outboxRows })
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

  it('returns null and skips outbox/emit when the guard loses the race', async () => {
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

    const result = await store.approveReply(
      makeReply({ status: 'pending_approval' }),
      { status: 'approved' },
      reviewReplyApproved({
        replyId: REPLY_ID,
        reviewId: REVIEW_ID,
        propertyId: PROP_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        authorId: USER_ID,
        occurredAt: NOW,
      }),
      NOW,
    )

    expect(result).toBeNull()
    expect(recordOutbox).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
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
