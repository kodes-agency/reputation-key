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
    externalId: 'ext-1',
    rating: 5,
    reviewerName: 'Jane',
    reviewText: 'Great',
    occurredAt: NOW,
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
      reviewerName: 'Jane',
      reviewerProfilePhotoUrl: null,
      rating: 5,
      text: 'Great',
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
      order.push(insertCalls === 1 ? 'tx.review' : 'tx.outbox')
      if (insertCalls === 1) {
        return { values }
      }
      return {
        values: vi.fn().mockResolvedValue(undefined),
      }
    })

    const transaction = vi.fn(
      async (fn: (tx: { insert: typeof txInsert }) => Promise<unknown>) => {
        order.push('tx.start')
        const result = await fn({ insert: txInsert })
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

    await store.upsertAndRecord(makeReview(), makeEvent(), NOW)

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['tx.start', 'tx.review', 'tx.outbox', 'tx.commit', 'emit'])
    expect(events.emit).toHaveBeenCalledTimes(1)
  })
})
