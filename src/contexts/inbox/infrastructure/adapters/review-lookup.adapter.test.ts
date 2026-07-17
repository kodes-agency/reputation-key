// BQC-1.2 — the review lookup is the authorized read for inbox surfaces.
// It enforces source eligibility: expired or clock-less content is never
// served (fail closed), and filters (rating range, text search) run inside
// the Review context against eligible rows only.

import { describe, it, expect, vi } from 'vitest'
import { createReviewLookupAdapter } from './review-lookup.adapter'
import { organizationId, reviewId } from '#/shared/domain/ids'

const ORG = organizationId('org-1')
const NOW = new Date('2026-07-17T12:00:00Z')
const FRESH_EXPIRY = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000)
const STALE_EXPIRY = new Date(NOW.getTime() - 1)

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rev-1',
    reviewerName: 'Jane Guest',
    text: 'Great stay',
    reviewerProfilePhotoUrl: 'https://photo.example/j.jpg',
    rating: 5,
    contentExpiresAt: FRESH_EXPIRY,
    ...overrides,
  }
}

function makeAdapter(rowOverrides: Record<string, unknown> | null = {}) {
  const findReviewById = vi.fn(async () =>
    rowOverrides === null ? null : makeRow(rowOverrides),
  )
  const findReviewsByIds = vi.fn(async () =>
    rowOverrides === null ? [] : [makeRow(rowOverrides)],
  )
  const findReviewIdsByContentFilter = vi.fn(async () => ['rev-1', 'rev-2'])
  const adapter = createReviewLookupAdapter({
    findReviewById: findReviewById as never,
    findReviewsByIds: findReviewsByIds as never,
    findReviewIdsByContentFilter: findReviewIdsByContentFilter as never,
    clock: () => NOW,
  })
  return { adapter, findReviewById, findReviewsByIds, findReviewIdsByContentFilter }
}

describe('review lookup adapter — source eligibility (BQC-1.2)', () => {
  it('serves content with rating when the fetch clock is fresh', async () => {
    const { adapter } = makeAdapter()
    const result = await adapter.getReviewSnippetById(reviewId('rev-1'), ORG)
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
    const { adapter } = makeAdapter({ contentExpiresAt: STALE_EXPIRY })
    const result = await adapter.getReviewSnippetById(reviewId('rev-1'), ORG)
    expect(result.status).toBe('expired')
  })

  it('denies content when the fetch clock is missing (fail closed)', async () => {
    const { adapter } = makeAdapter({ contentExpiresAt: null })
    const result = await adapter.getReviewSnippetById(reviewId('rev-1'), ORG)
    expect(result.status).toBe('expired')
  })

  it('reports not_found when the review does not exist', async () => {
    const { adapter } = makeAdapter(null)
    const result = await adapter.getReviewSnippetById(reviewId('rev-missing'), ORG)
    expect(result.status).toBe('not_found')
  })

  it('denies content at the exact expiry boundary (now > contentExpiresAt fails)', async () => {
    const { adapter } = makeAdapter({ contentExpiresAt: NOW })
    const result = await adapter.getReviewSnippetById(reviewId('rev-1'), ORG)
    expect(result.status).toBe('expired')
  })

  it('batch lookup returns only eligible snippets', async () => {
    const { adapter } = makeAdapter()
    const map = await adapter.getReviewSnippetsByIds([reviewId('rev-1')], ORG)
    expect(map.get('rev-1')?.rating).toBe(5)
  })

  it('batch lookup omits expired rows', async () => {
    const { adapter } = makeAdapter({ contentExpiresAt: STALE_EXPIRY })
    const map = await adapter.getReviewSnippetsByIds([reviewId('rev-1')], ORG)
    expect(map.size).toBe(0)
  })

  it('delegates rating/search filters to the Review-owned eligible query', async () => {
    const { adapter, findReviewIdsByContentFilter } = makeAdapter()
    const ids = await adapter.findEligibleReviewIds(ORG, {
      ratingMin: 4,
      textQuery: 'breakfast',
    })
    expect(ids).toEqual(['rev-1', 'rev-2'])
    expect(findReviewIdsByContentFilter).toHaveBeenCalledWith(
      ORG,
      { ratingMin: 4, ratingMax: undefined, textQuery: 'breakfast' },
      NOW,
    )
  })
})
