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
    const review = makeReview()
    const saved = {
      ...review,
      analysisSequence: 1,
      createdAt: NOW,
      updatedAt: NOW,
    }
    const txInsert = vi.fn(() => {
      order.push('tx.outbox')
      return {
        values: vi.fn().mockResolvedValue(undefined),
      }
    })

    const execute = vi.fn().mockResolvedValue({
      rows: [{ analysis_sequence: '1' }],
    })
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
    }))

    const transaction = vi.fn(
      async (
        fn: (tx: {
          insert: typeof txInsert
          execute: typeof execute
          select: typeof select
        }) => Promise<unknown>,
      ) => {
        order.push('tx.start')
        const result = await fn({ insert: txInsert, execute, select })
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

    const persistObservation: NonNullable<
      Parameters<typeof createAtomicReviewCommandStore>[2]
    > = vi.fn(async (_tx, input) => {
      order.push('tx.observation')
      return {
        review: { ...saved, analysisSequence: input.review.analysisSequence },
        observationSequence: 1,
        materialRevision: 1,
        comparison: 'initial_material_revision' as const,
        createsMaterialRevision: true,
        duplicate: false,
        outOfOrder: false,
      }
    })
    const db = { transaction } as unknown as Database
    const store = createAtomicReviewCommandStore(db, events, persistObservation)

    const eventFactory = vi.fn(
      (persisted: Review) =>
        ({
          ...makeEvent(),
          sourceRevision: persisted.sourceRevision,
          analysisSequence: persisted.analysisSequence,
        }) as DomainEvent,
    )
    await store.upsertAndRecord(review, eventFactory, NOW, 'f'.repeat(64))

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(order).toEqual([
      'tx.start',
      'tx.observation',
      'tx.outbox',
      'tx.commit',
      'emit',
    ])
    expect(events.emit).toHaveBeenCalledTimes(1)
    expect(persistObservation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        review: expect.objectContaining({
          text: 'Great',
          translatedText: null,
          languageCode: 'en',
          rating: 5,
          analysisSequence: 1,
        }),
        observationKey: 'f'.repeat(64),
      }),
    )
    expect(eventFactory).toHaveBeenCalledWith(
      expect.objectContaining({ analysisSequence: 1, sourceRevision: 1 }),
    )
  })
})
