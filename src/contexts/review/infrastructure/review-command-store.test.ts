// BQR-2.3 — atomic review command store contract tests.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createAtomicReviewCommandStore,
  createSequentialReviewCommandStore,
} from './review-command-store'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))
import {
  organizationId,
  propertyId,
  reviewId,
  googleConnectionId,
} from '#/shared/domain/ids'
import type { Review } from '../domain/types'

const NOW = new Date('2025-06-01T12:00:00.000Z')

function makeReview(): Omit<Review, 'createdAt' | 'updatedAt'> {
  return {
    id: reviewId('rev-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'loc-1',
    googleConnectionId: googleConnectionId('conn-1'),
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: NOW,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: NOW,
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
  }
}

function makeEvent(): DomainEvent {
  return {
    _tag: 'review.created',
    eventId: 'evt-1',
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    reviewId: reviewId('rev-1'),
    platform: 'google',
    sourceEpoch: 2,
    sourceRevision: 3,
    analysisSequence: 4,
    occurredAt: NOW,
    correlationId: null,
  } as DomainEvent
}

describe('createSequentialReviewCommandStore', () => {
  it('upserts then records outbox then emits', async () => {
    const order: string[] = []
    const review = makeReview()
    const saved = { ...review, createdAt: NOW, updatedAt: NOW }

    const store = createSequentialReviewCommandStore({
      upsert: async () => {
        order.push('upsert')
        return saved
      },
      recordOutbox: async () => {
        order.push('outbox')
      },
      events: {
        on: vi.fn(),
        emit: async () => {
          order.push('emit')
        },
        clear: vi.fn(),
      },
    })

    const result = await store.upsertAndRecord(review, makeEvent(), NOW)
    expect(result).toEqual(saved)
    expect(order).toEqual(['upsert', 'outbox', 'emit'])
  })
})

describe('createAtomicReviewCommandStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEventSchemas()
    registerAllEventSchemas()
  })

  it('runs upsert + outbox insert inside a single transaction before emit', async () => {
    const order: string[] = []
    const row = {
      id: 'rev-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      platform: 'google',
      externalId: 'ext-1',
      externalLocationId: 'loc-1',
      googleConnectionId: 'conn-1',
      reviewerProfilePhotoUrl: null,
      rating: 5,
      text: 'Great',
      translatedText: null,
      languageCode: 'en',
      reviewedAt: NOW,
      expiresAt: NOW,
      sentimentLabel: null,
      sentimentScore: null,
      sourceCreatedAt: NOW,
      sourceUpdatedAt: null,
      firstFetchedAt: NOW,
      lastFetchedAt: NOW,
      contentExpiresAt: null,
      contentHash: null,
      sourceSeenGeneration: null,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      aiSourceByteLength: 1,
      aiSourceDigest: '0'.repeat(64),
      sourceContentState: 'active',
      sourceContentErasedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    }

    const returning = vi.fn().mockResolvedValue([row])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const insert = vi.fn(() => {
      order.push('insert')
      return { values }
    })

    // Second insert is outbox
    let insertCalls = 0
    const txInsert = vi.fn(() => {
      insertCalls++
      order.push(
        insertCalls === 1
          ? 'tx.review'
          : insertCalls === 2
            ? 'tx.source-content'
            : 'tx.outbox',
      )
      if (insertCalls <= 2) {
        return { values }
      }
      return {
        values: vi.fn().mockResolvedValue(undefined),
      }
    })

    const execute = vi.fn().mockResolvedValue({
      rows: [{ analysis_sequence: '1' }],
    })

    const transaction = vi.fn(
      async (
        fn: (tx: {
          insert: typeof txInsert
          execute: typeof execute
        }) => Promise<unknown>,
      ) => {
        order.push('tx.start')
        const result = await fn({ insert: txInsert, execute })
        order.push('tx.commit')
        return result
      },
    )

    const events: EventBus = {
      on: vi.fn(),
      emit: vi.fn(async () => {
        order.push('emit')
      }),
      clear: vi.fn(),
    }

    const db = { transaction, insert } as unknown as Database
    const store = createAtomicReviewCommandStore(db, events)

    const eventFactory = vi.fn(
      (persisted: Review) =>
        ({
          ...makeEvent(),
          sourceRevision: persisted.sourceRevision,
          analysisSequence: persisted.analysisSequence,
        }) as DomainEvent,
    )
    await store.upsertAndRecord(makeReview(), eventFactory, NOW)

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(order).toEqual([
      'tx.start',
      'tx.review',
      'tx.source-content',
      'tx.outbox',
      'tx.commit',
      'emit',
    ])
    expect(events.emit).toHaveBeenCalledTimes(1)
    // Every provider-refreshed content column must be in the conflict update
    // set. translatedText was missing, so a review whose Google translation
    // appeared (or changed) after the first fetch kept the stale value.
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          text: 'Great',
          translatedText: null,
          languageCode: 'en',
          rating: 5,
        }),
      }),
    )
    expect(eventFactory).toHaveBeenCalledWith(
      expect.objectContaining({ analysisSequence: 1, sourceRevision: 1 }),
    )
  })
})
