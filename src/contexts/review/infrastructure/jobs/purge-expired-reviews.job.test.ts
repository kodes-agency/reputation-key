// Unit tests for purge expired reviews job handler
// Asserts on state and call ordering, not just invocation counts.
import { describe, it, expect, vi } from 'vitest'
import type { Review } from '../../domain/types'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { EventBus } from '#/shared/events/event-bus'
import { reviewId, propertyId, organizationId } from '#/shared/domain/ids'
import { createPurgeExpiredReviewsHandler } from './purge-expired-reviews.job'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))

function makeReview(overrides: Partial<Review> = {}): Review {
  const lastFetchedAt = new Date('2025-01-01')
  const contentExpiresAt = new Date('2025-01-31')
  return {
    id: reviewId('rev-1'),
    organizationId: organizationId('org-1'),
    propertyId: propertyId('prop-1'),
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'loc-1',
    googleConnectionId: null,
    reviewerName: null,
    reviewerProfilePhotoUrl: null,
    rating: 3,
    text: null,
    languageCode: null,
    reviewedAt: lastFetchedAt,
    expiresAt: contentExpiresAt,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: lastFetchedAt,
    sourceUpdatedAt: null,
    firstFetchedAt: lastFetchedAt,
    lastFetchedAt,
    contentExpiresAt,
    contentHash: 'abc',
    sourceSeenGeneration: null,
    createdAt: lastFetchedAt,
    updatedAt: lastFetchedAt,
    ...overrides,
  }
}

// Tracks the order of emit and deleteById calls to verify emit-before-delete
function createCallTracker() {
  const log: Array<{ action: 'emit' | 'delete'; id: string }> = []
  return {
    log,
    emit: vi.fn(async (event: { reviewId: string }) => {
      log.push({ action: 'emit', id: String(event.reviewId) })
    }),
    deleteById: vi.fn(async (_id: string, _orgId: string) => {
      log.push({ action: 'delete', id: String(_id) })
    }),
  }
}

describe('createPurgeExpiredReviewsHandler', () => {
  // ── Happy path ───────────────────────────────────────────────────

  it('emits review.expired BEFORE deleting each review', async () => {
    const reviews = [
      makeReview({ id: reviewId('rev-1') }),
      makeReview({ id: reviewId('rev-2') }),
      makeReview({ id: reviewId('rev-3') }),
    ]
    const tracker = createCallTracker()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi.fn().mockResolvedValue(reviews),
        deleteById: tracker.deleteById,
      } as unknown as ReviewRepository,
      events: { emit: tracker.emit } as unknown as EventBus,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
    })

    await handler({} as never)

    // For each review: emit comes before delete
    for (const id of ['rev-1', 'rev-2', 'rev-3']) {
      const emitIdx = tracker.log.findIndex((e) => e.action === 'emit' && e.id === id)
      const deleteIdx = tracker.log.findIndex((e) => e.action === 'delete' && e.id === id)
      expect(emitIdx).toBeGreaterThan(-1)
      expect(deleteIdx).toBeGreaterThan(-1)
      expect(emitIdx).toBeLessThan(deleteIdx)
    }
  })

  it('emits correct payload including reviewId, propertyId, orgId, occurredAt', async () => {
    const review = makeReview({
      id: reviewId('rev-42'),
      propertyId: propertyId('prop-99'),
      organizationId: organizationId('org-7'),
    })
    const fixedDate = new Date('2025-06-01T08:30:00Z')
    const emit = vi.fn().mockResolvedValue(undefined)

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi.fn().mockResolvedValue([review]),
        deleteById: vi.fn().mockResolvedValue(undefined),
      } as unknown as ReviewRepository,
      events: { emit } as unknown as EventBus,
      clock: vi.fn(() => fixedDate),
    })

    await handler({} as never)

    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        _tag: 'review.expired',
        reviewId: reviewId('rev-42'),
        propertyId: propertyId('prop-99'),
        organizationId: organizationId('org-7'),
        occurredAt: fixedDate,
      }),
    )
  })

  // ── ADR 0031: no post-expiry grace ───────────────────────────────

  it('uses now as exclusive contentExpiresAt threshold (no 3-day grace)', async () => {
    const now = new Date('2025-12-31T23:59:59.999Z')
    const findAllExpiredBeforeAcrossTenants = vi.fn().mockResolvedValue([])

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants,
        deleteById: vi.fn(),
      } as unknown as ReviewRepository,
      events: { emit: vi.fn() } as unknown as EventBus,
      clock: vi.fn(() => now),
    })

    await handler({} as never)

    const threshold = findAllExpiredBeforeAcrossTenants.mock.calls[0][0] as Date
    expect(threshold.getTime()).toBe(now.getTime())
  })

  it('uses a single clock reading for threshold and occurredAt', async () => {
    const fixed = new Date('2025-01-10T00:00:00Z')
    const clock = vi.fn(() => fixed)
    const emit = vi.fn().mockResolvedValue(undefined)
    const findAllExpiredBeforeAcrossTenants = vi.fn().mockResolvedValue([makeReview()])

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants,
        deleteById: vi.fn(),
      } as unknown as ReviewRepository,
      events: { emit } as unknown as EventBus,
      clock,
    })

    await handler({} as never)

    expect(clock).toHaveBeenCalledTimes(1)
    expect(findAllExpiredBeforeAcrossTenants.mock.calls[0][0]).toBe(fixed)
    expect(emit.mock.calls[0][0].occurredAt).toBe(fixed)
  })

  // ── Error resilience ─────────────────────────────────────────────

  it('continues when deleteById throws for one review', async () => {
    const review1 = makeReview({ id: reviewId('rev-ok') })
    const review2 = makeReview({ id: reviewId('rev-fail') })
    const review3 = makeReview({ id: reviewId('rev-ok-2') })
    const tracker = createCallTracker()
    tracker.deleteById.mockImplementation(async (id: string, _orgId: string) => {
      if (String(id) === 'rev-fail') throw new Error('delete failed')
      tracker.log.push({ action: 'delete', id: String(id) })
    })

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi
          .fn()
          .mockResolvedValue([review1, review2, review3]),
        deleteById: tracker.deleteById,
      } as unknown as ReviewRepository,
      events: { emit: tracker.emit } as unknown as EventBus,
      clock: vi.fn(() => new Date()),
    })

    await handler({} as never)

    // All 3 emitted
    expect(tracker.emit).toHaveBeenCalledTimes(3)
    // All 3 deleteById attempted
    expect(tracker.deleteById).toHaveBeenCalledTimes(3)
    // But only 2 actually deleted (rev-fail threw)
    const deleteActions = tracker.log.filter((e) => e.action === 'delete')
    expect(deleteActions).toHaveLength(2)
  })

  it('continues when events.emit throws for one review (review NOT deleted)', async () => {
    const review1 = makeReview({ id: reviewId('rev-emit-ok') })
    const review2 = makeReview({ id: reviewId('rev-emit-fail') })
    const review3 = makeReview({ id: reviewId('rev-emit-ok-2') })

    const emit = vi.fn().mockImplementation(async (event: { reviewId: string }) => {
      if (String(event.reviewId) === 'rev-emit-fail') throw new Error('emit failed')
    })
    const deleteById = vi.fn().mockResolvedValue(undefined)

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi
          .fn()
          .mockResolvedValue([review1, review2, review3]),
        deleteById,
      } as unknown as ReviewRepository,
      events: { emit } as unknown as EventBus,
      clock: vi.fn(() => new Date()),
    })

    await handler({} as never)

    // All 3 emit attempted
    expect(emit).toHaveBeenCalledTimes(3)
    // deleteById only called for reviews where emit succeeded
    // (emit and delete are in same try block — if emit throws, delete is skipped)
    const deletedIds = deleteById.mock.calls.map((c) => String(c[0]))
    expect(deletedIds).not.toContain('rev-emit-fail')
    expect(deletedIds).toContain('rev-emit-ok')
    expect(deletedIds).toContain('rev-emit-ok-2')
  })

  // ── Edge cases ───────────────────────────────────────────────────

  it('does nothing when no expired reviews', async () => {
    const emit = vi.fn().mockResolvedValue(undefined)
    const deleteById = vi.fn().mockResolvedValue(undefined)

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi.fn().mockResolvedValue([]),
        deleteById,
      } as unknown as ReviewRepository,
      events: { emit } as unknown as EventBus,
      clock: vi.fn(() => new Date()),
    })

    await handler({} as never)

    expect(emit).not.toHaveBeenCalled()
    expect(deleteById).not.toHaveBeenCalled()
  })
})
