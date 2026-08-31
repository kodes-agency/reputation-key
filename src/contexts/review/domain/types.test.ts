// `defaultReviewLifecycle` is the one place a review's provenance clocks are
// derived, and every field in it is a claim about where a value came from. The
// dangerous half is what it must NOT do: preserve a stale content expiry,
// overwrite a first-seen instant, or infer a guest edit from a metadata change.

import { describe, expect, it } from 'vitest'
import { contentExpiresAtFromFetch } from '#/shared/domain/source-content-policy'
import { defaultReviewLifecycle } from './types'

const REVIEWED_AT = new Date('2026-08-01T09:00:00.000Z')
const FIRST_FETCH = new Date('2026-08-20T10:00:00.000Z')
const NOW = new Date('2026-08-28T12:00:00.000Z')

const args = {
  reviewedAt: REVIEWED_AT,
  now: NOW,
  aiSourceByteLength: 42,
  aiSourceDigest: 'a'.repeat(64),
}

describe('defaultReviewLifecycle', () => {
  it('seeds a first observation from the review itself', () => {
    expect(defaultReviewLifecycle(args)).toEqual({
      sourceCreatedAt: REVIEWED_AT,
      sourceUpdatedAt: null,
      firstFetchedAt: NOW,
      lastFetchedAt: NOW,
      contentExpiresAt: contentExpiresAtFromFetch(NOW),
      contentHash: null,
      sourceSeenGeneration: null,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 0,
      aiSourceByteLength: 42,
      aiSourceDigest: 'a'.repeat(64),
    })
  })

  it('keeps the first observation first, and moves only the current fetch', () => {
    const existing = {
      sourceCreatedAt: new Date('2026-07-01T00:00:00.000Z'),
      sourceUpdatedAt: new Date('2026-07-02T00:00:00.000Z'),
      firstFetchedAt: FIRST_FETCH,
      lastFetchedAt: new Date('2026-08-21T00:00:00.000Z'),
      contentExpiresAt: new Date('2026-08-22T00:00:00.000Z'),
      contentHash: 'previous',
      sourceSeenGeneration: 'gen-4',
      sourceEpoch: 3,
      sourceRevision: 9,
      analysisSequence: 7,
      aiSourceByteLength: 1,
      aiSourceDigest: 'b'.repeat(64),
    }

    const refreshed = defaultReviewLifecycle({ ...args, existing })

    expect(refreshed.firstFetchedAt).toBe(FIRST_FETCH)
    expect(refreshed.sourceCreatedAt).toBe(existing.sourceCreatedAt)
    expect(refreshed.sourceUpdatedAt).toBe(existing.sourceUpdatedAt)
    expect(refreshed.lastFetchedAt).toBe(NOW)
    // Always derived from THIS fetch. A preserved expiry would let content
    // outlive the retention window the fetch that produced it was governed by.
    expect(refreshed.contentExpiresAt).toEqual(contentExpiresAtFromFetch(NOW))
    expect(refreshed.contentExpiresAt).not.toEqual(existing.contentExpiresAt)
  })

  it('never infers a guest edit: the revision is preserved, not bumped', () => {
    // The repository-owned material comparator is the sole revision authority.
    // A changed AI digest or byte length is not evidence the guest rewrote
    // anything, and treating it as such would reopen handling work.
    const refreshed = defaultReviewLifecycle({
      ...args,
      aiSourceDigest: 'c'.repeat(64),
      aiSourceByteLength: 999,
      existing: {
        sourceCreatedAt: REVIEWED_AT,
        sourceUpdatedAt: null,
        firstFetchedAt: FIRST_FETCH,
        lastFetchedAt: FIRST_FETCH,
        contentExpiresAt: null,
        contentHash: 'unchanged',
        sourceSeenGeneration: null,
        sourceEpoch: 2,
        sourceRevision: 5,
        analysisSequence: 3,
        aiSourceByteLength: 1,
        aiSourceDigest: 'b'.repeat(64),
      },
    })

    expect(refreshed.sourceRevision).toBe(5)
    expect(refreshed.analysisSequence).toBe(3)
    expect(refreshed.aiSourceDigest).toBe('c'.repeat(64))
    expect(refreshed.aiSourceByteLength).toBe(999)
  })

  it('prefers a caller-supplied content hash and epoch over the stored ones', () => {
    const refreshed = defaultReviewLifecycle({
      ...args,
      contentHash: 'current',
      sourceEpoch: 11,
      existing: {
        sourceCreatedAt: REVIEWED_AT,
        sourceUpdatedAt: null,
        firstFetchedAt: FIRST_FETCH,
        lastFetchedAt: FIRST_FETCH,
        contentExpiresAt: null,
        contentHash: 'previous',
        sourceSeenGeneration: null,
        sourceEpoch: 2,
        sourceRevision: 1,
        analysisSequence: 0,
        aiSourceByteLength: 1,
        aiSourceDigest: 'b'.repeat(64),
      },
    })

    expect(refreshed.contentHash).toBe('current')
    expect(refreshed.sourceEpoch).toBe(11)
  })
})
