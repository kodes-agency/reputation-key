// Unit tests for refresh expiring reviews job handler
// Tests: grouping logic, enqueue behavior, error resilience, clock usage.
import { describe, it, expect, vi } from 'vitest'
import type { Review } from '../../domain/types'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReviewQueuePort } from '../../application/ports/review-queue.port'
import {
  reviewId,
  propertyId,
  organizationId,
  googleConnectionId,
} from '#/shared/domain/ids'
import { createRefreshExpiringReviewsHandler } from './refresh-expiring-reviews.job'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

const ORG_ID = organizationId('org-1')
const PROP_A = propertyId('prop-a')
const PROP_B = propertyId('prop-b')
const CONN_ID = googleConnectionId('conn-1')
const NOW = new Date('2025-06-01T12:00:00.000Z')

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: reviewId('rev-1'),
    organizationId: ORG_ID,
    propertyId: PROP_A,
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: CONN_ID,
    reviewerName: null,
    reviewerProfilePhotoUrl: null,
    rating: 3,
    text: null,
    languageCode: null,
    reviewedAt: new Date('2025-05-01'),
    expiresAt: new Date('2025-06-03'),
    sentimentLabel: null,
    sentimentScore: null,
    createdAt: new Date('2025-05-01'),
    updatedAt: new Date('2025-05-01'),
    ...overrides,
  }
}

describe('createRefreshExpiringReviewsHandler', () => {
  // ── Happy path ───────────────────────────────────────────────────

  it('enqueues one sync job per unique (property, connection, location) group', async () => {
    const reviews = [
      makeReview({
        id: reviewId('rev-1'),
        propertyId: PROP_A,
        externalLocationId: 'loc-A',
      }),
      makeReview({
        id: reviewId('rev-2'),
        propertyId: PROP_A,
        externalLocationId: 'loc-A',
      }), // same group
      makeReview({
        id: reviewId('rev-3'),
        propertyId: PROP_B,
        externalLocationId: 'loc-B',
      }), // different property
    ]

    const addSyncJob = vi.fn().mockResolvedValue(undefined)

    const handler = createRefreshExpiringReviewsHandler({
      reviewRepo: {
        findAllExpiringBefore: vi.fn().mockResolvedValue(reviews),
      } as unknown as ReviewRepository,
      queue: { addSyncJob } as ReviewQueuePort,
      clock: vi.fn(() => NOW),
    })

    await handler({} as never)

    expect(addSyncJob).toHaveBeenCalledTimes(2)
    // First group: PROP_A + loc-A
    expect(addSyncJob).toHaveBeenNthCalledWith(1, {
      propertyId: PROP_A as string,
      organizationId: ORG_ID as string,
      connectionId: CONN_ID as string,
      locationName: 'loc-A',
    })
    // Second group: PROP_B + loc-B
    expect(addSyncJob).toHaveBeenNthCalledWith(2, {
      propertyId: PROP_B as string,
      organizationId: ORG_ID as string,
      connectionId: CONN_ID as string,
      locationName: 'loc-B',
    })
  })

  it('skips reviews without googleConnectionId', async () => {
    const reviews = [
      makeReview({ id: reviewId('rev-1'), googleConnectionId: null }),
      makeReview({ id: reviewId('rev-2'), googleConnectionId: CONN_ID }),
    ]

    const addSyncJob = vi.fn().mockResolvedValue(undefined)

    const handler = createRefreshExpiringReviewsHandler({
      reviewRepo: {
        findAllExpiringBefore: vi.fn().mockResolvedValue(reviews),
      } as unknown as ReviewRepository,
      queue: { addSyncJob } as ReviewQueuePort,
      clock: vi.fn(() => NOW),
    })

    await handler({} as never)

    expect(addSyncJob).toHaveBeenCalledTimes(1)
    expect(addSyncJob).toHaveBeenCalledWith({
      propertyId: PROP_A as string,
      organizationId: ORG_ID as string,
      connectionId: CONN_ID as string,
      locationName: 'accounts/111/locations/222',
    })
  })

  // ── Clock usage ──────────────────────────────────────────────────

  it('queries reviews expiring within 5 days from clock', async () => {
    const findAllExpiringBefore = vi.fn().mockResolvedValue([])

    const handler = createRefreshExpiringReviewsHandler({
      reviewRepo: { findAllExpiringBefore } as unknown as ReviewRepository,
      queue: { addSyncJob: vi.fn() } as ReviewQueuePort,
      clock: vi.fn(() => NOW),
    })

    await handler({} as never)

    const threshold = findAllExpiringBefore.mock.calls[0][0] as Date
    const expectedThreshold = new Date(NOW.getTime() + 5 * 24 * 60 * 60 * 1000)
    expect(threshold.getTime()).toBe(expectedThreshold.getTime())
  })

  // ── Error resilience ─────────────────────────────────────────────

  it('continues when addSyncJob throws for one property', async () => {
    const reviews = [
      makeReview({
        id: reviewId('rev-1'),
        propertyId: PROP_A,
        externalLocationId: 'loc-A',
      }),
      makeReview({
        id: reviewId('rev-2'),
        propertyId: PROP_B,
        externalLocationId: 'loc-B',
      }),
    ]

    let callCount = 0
    const addSyncJob = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount === 1) throw new Error('Queue unavailable')
    })

    const handler = createRefreshExpiringReviewsHandler({
      reviewRepo: {
        findAllExpiringBefore: vi.fn().mockResolvedValue(reviews),
      } as unknown as ReviewRepository,
      queue: { addSyncJob } as ReviewQueuePort,
      clock: vi.fn(() => NOW),
    })

    await handler({} as never)

    // Both attempted, only second succeeded
    expect(addSyncJob).toHaveBeenCalledTimes(2)
  })

  // ── Edge cases ───────────────────────────────────────────────────

  it('does nothing when no expiring reviews', async () => {
    const addSyncJob = vi.fn().mockResolvedValue(undefined)

    const handler = createRefreshExpiringReviewsHandler({
      reviewRepo: {
        findAllExpiringBefore: vi.fn().mockResolvedValue([]),
      } as unknown as ReviewRepository,
      queue: { addSyncJob } as ReviewQueuePort,
      clock: vi.fn(() => NOW),
    })

    await handler({} as never)

    expect(addSyncJob).not.toHaveBeenCalled()
  })

  it('does nothing when all expiring reviews lack googleConnectionId', async () => {
    const reviews = [
      makeReview({ id: reviewId('rev-1'), googleConnectionId: null }),
      makeReview({ id: reviewId('rev-2'), googleConnectionId: null }),
    ]

    const addSyncJob = vi.fn().mockResolvedValue(undefined)

    const handler = createRefreshExpiringReviewsHandler({
      reviewRepo: {
        findAllExpiringBefore: vi.fn().mockResolvedValue(reviews),
      } as unknown as ReviewRepository,
      queue: { addSyncJob } as ReviewQueuePort,
      clock: vi.fn(() => NOW),
    })

    await handler({} as never)

    expect(addSyncJob).not.toHaveBeenCalled()
  })
})
