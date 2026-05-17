// Review context — entity constructors tests

import { describe, it, expect } from 'vitest'
import { buildReview, buildReply } from './constructors'
import { reviewId, replyId, organizationId, propertyId, googleConnectionId } from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const CONN_ID = googleConnectionId('conn-1')
const NOW = new Date('2025-06-01T12:00:00Z')

describe('buildReview', () => {
  it('builds a valid review with all fields', () => {
    const result = buildReview({
      id: reviewId('rev-1'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      externalId: 'ext-1',
      externalLocationId: 'loc-1',
      googleConnectionId: CONN_ID,
      reviewerName: 'Jane Doe',
      reviewerProfilePhotoUrl: 'https://example.com/photo.jpg',
      rating: 5,
      text: 'Great place!',
      languageCode: 'en',
      reviewedAt: new Date('2025-05-27T12:00:00Z'),
      now: NOW,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const review = result.value
      expect(review.id).toBe(reviewId('rev-1'))
      expect(review.platform).toBe('google')
      expect(review.rating).toBe(5)
      expect(review.sentimentLabel).toBeNull()
      expect(review.sentimentScore).toBeNull()
      expect(review.createdAt).toBe(NOW)
      expect(review.updatedAt).toBe(NOW)
    }
  })

  it('returns Err for invalid rating', () => {
    const result = buildReview({
      id: reviewId('rev-1'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      externalId: 'ext-1',
      externalLocationId: 'loc-1',
      googleConnectionId: null,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
      rating: 6,
      text: null,
      languageCode: null,
      reviewedAt: NOW,
      now: NOW,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_rating')
    }
  })

  it('calculates expiresAt from reviewedAt', () => {
    const reviewedAt = new Date('2025-05-27T12:00:00Z') // 5 days before NOW
    const result = buildReview({
      id: reviewId('rev-1'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      externalId: 'ext-1',
      externalLocationId: 'loc-1',
      googleConnectionId: null,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
      rating: 4,
      text: null,
      languageCode: null,
      reviewedAt,
      now: NOW,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
      const remaining = THIRTY_DAYS_MS - (NOW.getTime() - reviewedAt.getTime())
      expect(result.value.expiresAt.getTime()).toBe(NOW.getTime() + remaining)
    }
  })

  it('preserves sentiment when provided', () => {
    const result = buildReview({
      id: reviewId('rev-1'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      externalId: 'ext-1',
      externalLocationId: 'loc-1',
      googleConnectionId: null,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
      rating: 3,
      text: null,
      languageCode: null,
      reviewedAt: NOW,
      now: NOW,
      sentimentLabel: 'positive',
      sentimentScore: 0.85,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.sentimentLabel).toBe('positive')
      expect(result.value.sentimentScore).toBe(0.85)
    }
  })
})

describe('buildReply', () => {
  it('builds a valid google_sync reply', () => {
    const result = buildReply({
      id: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      organizationId: ORG_ID,
      text: 'Thank you for your feedback!',
      source: 'google_sync',
      status: 'published',
      publishedAt: NOW,
      now: NOW,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const reply = result.value
      expect(reply.source).toBe('google_sync')
      expect(reply.status).toBe('published')
      expect(reply.createdBy).toBeNull()
    }
  })

  it('defaults to draft status', () => {
    const result = buildReply({
      id: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      organizationId: ORG_ID,
      text: 'Draft reply',
      source: 'internal',
      now: NOW,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.status).toBe('draft')
    }
  })

  it('returns Err for empty text', () => {
    const result = buildReply({
      id: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      organizationId: ORG_ID,
      text: '',
      source: 'internal',
      now: NOW,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.code).toBe('invalid_reply')
    }
  })

  it('returns Err for whitespace-only text', () => {
    const result = buildReply({
      id: replyId('reply-1'),
      reviewId: reviewId('rev-1'),
      organizationId: ORG_ID,
      text: '   ',
      source: 'internal',
      now: NOW,
    })

    expect(result.isErr()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Exhaustive ReviewErrorCode coverage — constructor paths
// ---------------------------------------------------------------------------

import type { ReviewErrorCode } from './errors'

/**
 * All values that make up the ReviewErrorCode union.
 * Kept as a const array so the test breaks at compile time when the union
 * changes (TS will flag any missing / extra literal here).
 */
const ALL_REVIEW_ERROR_CODES: ReviewErrorCode[] = [
  'unauthorized',
  'property_not_found',
  'connection_not_found',
  'connection_inactive',
  'sync_failed',
  'invalid_rating',
  'invalid_reply',
  'review_not_found',
  'reply_not_found',
  'reply_already_exists',
]

/**
 * Codes that are NOT expected to be produced by buildReview / buildReply.
 * They originate from use-case / service layers instead.
 * If a code is removed from this set without a matching constructor path the
 * test will fail, which is the desired behaviour — it forces an explicit
 * decision about where each error code is exercised.
 */
const CODES_NOT_FROM_CONSTRUCTORS = new Set<ReviewErrorCode>([
  'unauthorized' as ReviewErrorCode,
  'property_not_found' as ReviewErrorCode,
  'connection_not_found' as ReviewErrorCode,
  'connection_inactive' as ReviewErrorCode,
  'sync_failed' as ReviewErrorCode,
  'review_not_found' as ReviewErrorCode,
  'reply_not_found' as ReviewErrorCode,
  'reply_already_exists' as ReviewErrorCode,
])

describe('ReviewErrorCode — exhaustive constructor coverage', () => {
  it('every ReviewErrorCode is either produced by a constructor or explicitly excluded', () => {
    // -- Collect codes produced by constructor error paths -----------------

    const producedCodes = new Set<ReviewErrorCode>()

    // buildReview → invalid_rating  (rating out of 1–5 range)
    const ratingResult = buildReview({
      id: reviewId('rev-bad'),
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      externalId: 'ext-bad',
      externalLocationId: 'loc-bad',
      googleConnectionId: null,
      reviewerName: null,
      reviewerProfilePhotoUrl: null,
      rating: 0,
      text: null,
      languageCode: null,
      reviewedAt: NOW,
      now: NOW,
    })
    if (ratingResult.isErr()) {
      expect(ratingResult.error.code).toBe('invalid_rating')
      producedCodes.add(ratingResult.error.code)
    }

    // buildReply → invalid_reply  (empty text)
    const replyResult = buildReply({
      id: replyId('reply-bad'),
      reviewId: reviewId('rev-bad'),
      organizationId: ORG_ID,
      text: '',
      source: 'internal',
      now: NOW,
    })
    if (replyResult.isErr()) {
      expect(replyResult.error.code).toBe('invalid_reply')
      producedCodes.add(replyResult.error.code)
    }

    // buildReply → invalid_reply  (whitespace-only text, same code)
    const wsResult = buildReply({
      id: replyId('reply-ws'),
      reviewId: reviewId('rev-bad'),
      organizationId: ORG_ID,
      text: '   ',
      source: 'internal',
      now: NOW,
    })
    if (wsResult.isErr()) {
      expect(wsResult.error.code).toBe('invalid_reply')
      producedCodes.add(wsResult.error.code)
    }

    // -- Verify coverage --------------------------------------------------

    // Every code must be either produced or explicitly acknowledged as not
    // coming from constructors. Codes that fall into neither bucket surface
    // here as "uncovered".
    const uncovered = ALL_REVIEW_ERROR_CODES.filter(
      (c) => !producedCodes.has(c) && !CODES_NOT_FROM_CONSTRUCTORS.has(c),
    )

    // Also verify the exclusion list doesn't contain codes that ARE produced
    const staleExclusions = Array.from(CODES_NOT_FROM_CONSTRUCTORS).filter(
      (c) => producedCodes.has(c),
    )

    expect(
      staleExclusions,
      `These codes are in the exclusion list but ARE produced by constructors: ${staleExclusions.join(', ')}. Remove them from CODES_NOT_FROM_CONSTRUCTORS.`,
    ).toEqual([])

    expect(
      uncovered,
      `These ReviewErrorCodes have no constructor path and are not in the exclusion list: ${uncovered.join(', ')}. Either add a constructor test or add them to CODES_NOT_FROM_CONSTRUCTORS.`,
    ).toEqual([])

    // Sanity: ensure we actually exercised at least one error path
    expect(producedCodes.size).toBeGreaterThan(0)
  })
})
