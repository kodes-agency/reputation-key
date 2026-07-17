// BQC-1.4 — the governed read interface: every serving read crosses
// eligible-reads. Expired or clock-less content is never served (fail
// closed); filters run against eligible rows only.

import { describe, it, expect, vi } from 'vitest'
import { createEligibleReads } from './eligible-reads'
import type { ReviewRepository } from './ports/review.repository'
import type { Review } from '../domain/types'
import { organizationId, reviewId } from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const NOW = new Date('2026-07-17T12:00:00Z')
const FRESH_EXPIRY = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000)
const STALE_EXPIRY = new Date(NOW.getTime() - 1)

function makeReview(overrides: Record<string, unknown> = {}): Review {
  return {
    id: reviewId('rev-1'),
    organizationId: ORG,
    reviewerName: 'Jane Guest',
    text: 'Great stay',
    reviewerProfilePhotoUrl: 'https://photo.example/j.jpg',
    rating: 5,
    contentExpiresAt: FRESH_EXPIRY,
    ...overrides,
  } as Review
}

function makeDeps(rowOverrides: Record<string, unknown> | null = {}) {
  const reviewRepo = {
    findById: vi.fn(async () =>
      rowOverrides === null ? null : makeReview(rowOverrides),
    ),
    findByIds: vi.fn(async () =>
      rowOverrides === null ? [] : [makeReview(rowOverrides)],
    ),
    findIdsByContentFilter: vi.fn(async () => ['rev-1', 'rev-2']),
  }
  const reads = createEligibleReads({
    reviewRepo: reviewRepo as unknown as ReviewRepository,
    clock: () => NOW,
  })
  return { reads, reviewRepo }
}

describe('eligible reads (BQC-1.4)', () => {
  it('serves content when the fetch clock is fresh', async () => {
    const { reads } = makeDeps()
    const result = await reads.getReviewSnippetById(reviewId('rev-1'), ORG)
    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.snippet).toEqual({
      reviewerName: 'Jane Guest',
      text: 'Great stay',
      reviewerProfilePhotoUrl: 'https://photo.example/j.jpg',
      rating: 5,
    })
  })

  it('denies content when contentExpiresAt is in the past', async () => {
    const { reads } = makeDeps({ contentExpiresAt: STALE_EXPIRY })
    expect((await reads.getReviewSnippetById(reviewId('rev-1'), ORG)).status).toBe(
      'expired',
    )
  })

  it('denies content when the fetch clock is missing (fail closed)', async () => {
    const { reads } = makeDeps({ contentExpiresAt: null })
    expect((await reads.getReviewSnippetById(reviewId('rev-1'), ORG)).status).toBe(
      'expired',
    )
  })

  it('denies content at the exact expiry boundary', async () => {
    const { reads } = makeDeps({ contentExpiresAt: NOW })
    expect((await reads.getReviewSnippetById(reviewId('rev-1'), ORG)).status).toBe(
      'expired',
    )
  })

  it('reports not_found when the review does not exist', async () => {
    const { reads } = makeDeps(null)
    expect((await reads.getReviewSnippetById(reviewId('rev-x'), ORG)).status).toBe(
      'not_found',
    )
  })

  it('batch read returns only eligible snippets', async () => {
    const { reads } = makeDeps()
    const map = await reads.getReviewSnippetsByIds([reviewId('rev-1')], ORG)
    expect(map.get('rev-1')?.rating).toBe(5)
  })

  it('batch read omits expired rows', async () => {
    const { reads } = makeDeps({ contentExpiresAt: STALE_EXPIRY })
    expect((await reads.getReviewSnippetsByIds([reviewId('rev-1')], ORG)).size).toBe(0)
  })

  it('rating lookup returns null for expired or missing content', async () => {
    expect(await makeDeps().reads.getEligibleRatingById(reviewId('rev-1'), ORG)).toBe(5)
    expect(
      await makeDeps({ contentExpiresAt: STALE_EXPIRY }).reads.getEligibleRatingById(
        reviewId('rev-1'),
        ORG,
      ),
    ).toBeNull()
    expect(
      await makeDeps(null).reads.getEligibleRatingById(reviewId('rev-x'), ORG),
    ).toBeNull()
  })

  it('findEligibleReviewIds delegates to the repository eligible query with the clock', async () => {
    const { reads, reviewRepo } = makeDeps()
    const ids = await reads.findEligibleReviewIds(ORG, { ratingMin: 4, textQuery: 'spa' })
    expect(ids).toEqual(['rev-1', 'rev-2'])
    expect(reviewRepo.findIdsByContentFilter).toHaveBeenCalledWith(
      ORG,
      { ratingMin: 4, textQuery: 'spa' },
      NOW,
    )
  })
})
