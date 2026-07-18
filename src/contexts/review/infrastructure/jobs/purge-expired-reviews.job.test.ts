// Unit tests for purge expired reviews job handler
//
// BQC-3.3: the handler no longer emits-then-deletes. Each expired review is
// purged via ReplyCommandStore.purgeExpiredReview — review delete and the
// review.expired outbox fact commit in ONE transaction (atomicity proven in
// reply-command-store.test.ts unit + integration suites). A review whose
// purge tx fails stays in place and is retried on the next sweep.

import { describe, it, expect, vi } from 'vitest'
import type { Review } from '../../domain/types'
import type { ReviewRepository } from '../../application/ports/review.repository'
import type { ReplyCommandStore } from '../../application/ports/reply-command-store.port'
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

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
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

type PurgeCall = Readonly<{ reviewId: string; event: Record<string, unknown> }>

/** Fake command store recording successful purges; can fail specific reviews. */
function makeCommandStore(opts: { failFor?: ReadonlyArray<string> } = {}) {
  const calls: PurgeCall[] = []
  const store: ReplyCommandStore = {
    submitReply: vi.fn(),
    rejectReply: vi.fn(),
    markPublished: vi.fn(),
    markPublicationAuthorized: vi.fn(),
    markPublicationSending: vi.fn(),
    markPublicationTerminal: vi.fn(),
    markPublicationAmbiguous: vi.fn(),
    markPublicationRetryQueued: vi.fn(),
    cancelPublications: vi.fn(),
    mirrorSyncedReply: vi.fn(),
    purgeExpiredReview: vi.fn(async (id, event) => {
      if (opts.failFor?.includes(String(id))) throw new Error('purge tx failed')
      calls.push({ reviewId: String(id), event: event as Record<string, unknown> })
    }),
  }
  return { store, calls }
}

describe('createPurgeExpiredReviewsHandler', () => {
  // ── Happy path ───────────────────────────────────────────────────

  it('purges every expired review via the command store', async () => {
    const reviews = [
      makeReview({ id: reviewId('rev-1') }),
      makeReview({ id: reviewId('rev-2') }),
      makeReview({ id: reviewId('rev-3') }),
    ]
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi.fn().mockResolvedValue(reviews),
      } as unknown as ReviewRepository,
      commandStore: store,
      clock: vi.fn(() => new Date('2025-06-01T12:00:00Z')),
    })

    await handler({} as never)

    expect(calls.map((c) => c.reviewId)).toEqual(['rev-1', 'rev-2', 'rev-3'])
  })

  it('passes a review.expired fact with reviewId, propertyId, orgId, occurredAt', async () => {
    const review = makeReview({
      id: reviewId('rev-42'),
      propertyId: propertyId('prop-99'),
      organizationId: organizationId('org-7'),
    })
    const fixedDate = new Date('2025-06-01T08:30:00Z')
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi.fn().mockResolvedValue([review]),
      } as unknown as ReviewRepository,
      commandStore: store,
      clock: vi.fn(() => fixedDate),
    })

    await handler({} as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.event).toEqual(
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
      } as unknown as ReviewRepository,
      commandStore: makeCommandStore().store,
      clock: vi.fn(() => now),
    })

    await handler({} as never)

    const threshold = findAllExpiredBeforeAcrossTenants.mock.calls[0][0] as Date
    expect(threshold.getTime()).toBe(now.getTime())
  })

  it('uses a single clock reading for threshold and occurredAt', async () => {
    const fixed = new Date('2025-01-10T00:00:00Z')
    const clock = vi.fn(() => fixed)
    const findAllExpiredBeforeAcrossTenants = vi.fn().mockResolvedValue([makeReview()])
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants,
      } as unknown as ReviewRepository,
      commandStore: store,
      clock,
    })

    await handler({} as never)

    expect(clock).toHaveBeenCalledTimes(1)
    expect(findAllExpiredBeforeAcrossTenants.mock.calls[0][0]).toBe(fixed)
    expect(calls[0]!.event.occurredAt).toBe(fixed)
  })

  // ── Error resilience ─────────────────────────────────────────────

  it('continues when a purge fails for one review — the failed review is left for the next sweep', async () => {
    const reviews = [
      makeReview({ id: reviewId('rev-ok') }),
      makeReview({ id: reviewId('rev-fail') }),
      makeReview({ id: reviewId('rev-ok-2') }),
    ]
    const { store, calls } = makeCommandStore({ failFor: ['rev-fail'] })

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi.fn().mockResolvedValue(reviews),
      } as unknown as ReviewRepository,
      commandStore: store,
      clock: vi.fn(() => new Date()),
    })

    await handler({} as never)

    // All 3 attempted (store called per review); only the two successful
    // purges recorded. rev-fail's tx threw before commit, so its review row
    // and its (absent) outbox row stay consistent — retried next sweep.
    expect(store.purgeExpiredReview).toHaveBeenCalledTimes(3)
    expect(calls.map((c) => c.reviewId)).toEqual(['rev-ok', 'rev-ok-2'])
  })

  // ── Edge cases ───────────────────────────────────────────────────

  it('does nothing when no expired reviews', async () => {
    const { store, calls } = makeCommandStore()

    const handler = createPurgeExpiredReviewsHandler({
      reviewRepo: {
        findAllExpiredBeforeAcrossTenants: vi.fn().mockResolvedValue([]),
      } as unknown as ReviewRepository,
      commandStore: store,
      clock: vi.fn(() => new Date()),
    })

    await handler({} as never)

    expect(calls).toHaveLength(0)
    expect(store.purgeExpiredReview).not.toHaveBeenCalled()
  })
})
