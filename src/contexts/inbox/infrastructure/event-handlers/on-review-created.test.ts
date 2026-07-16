// Inbox context — on-review-created event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onReviewCreated } from './on-review-created'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))
import type { CreateInboxItem } from '../../application/use-cases/create-inbox-item'
import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
import type { ReviewCreated } from '#/contexts/review/application/public-api'
import { organizationId, reviewId, propertyId } from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const REVIEW_ID = reviewId('rev-1')
const PROP_ID = propertyId('prop-1')
const NOW = new Date('2025-06-01T12:00:00Z')

const mockEvent: ReviewCreated = {
  _tag: 'review.created',
  eventId: 'test-event-id',
  correlationId: null,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  platform: 'google',
  externalId: 'ext-1',
  rating: 4,
  occurredAt: NOW,
}

describe('onReviewCreated', () => {
  it('creates inbox item with content from review lookup (BQR-4.2)', async () => {
    const createInboxItem = vi.fn(async () => ({}))
    const reviewLookup = {
      getReviewSnippetById: vi.fn(async () => ({
        reviewerName: 'Test Reviewer',
        text: 'Nice hotel',
        reviewerProfilePhotoUrl: null,
      })),
      getReviewSnippetsByIds: vi.fn(async () => new Map()),
    } satisfies ReviewLookupPort

    await onReviewCreated({
      createInboxItem: createInboxItem as unknown as CreateInboxItem,
      reviewLookup,
    })(mockEvent)

    expect(reviewLookup.getReviewSnippetById).toHaveBeenCalledWith(REVIEW_ID, ORG_ID)
    expect(createInboxItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      sourceType: 'review',
      sourceId: REVIEW_ID,
      rating: 4,
      sourceDate: NOW,
      platform: 'google',
      snippet: 'Nice hotel',
      reviewerName: 'Test Reviewer',
    })
  })

  it('passes null snippet when lookup returns no text', async () => {
    const createInboxItem = vi.fn(async () => ({}))
    const reviewLookup = {
      getReviewSnippetById: vi.fn(async () => ({
        reviewerName: null,
        text: null,
        reviewerProfilePhotoUrl: null,
      })),
      getReviewSnippetsByIds: vi.fn(async () => new Map()),
    } satisfies ReviewLookupPort

    await onReviewCreated({
      createInboxItem: createInboxItem as unknown as CreateInboxItem,
      reviewLookup,
    })(mockEvent)

    expect(createInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ snippet: null, reviewerName: null }),
    )
  })

  it('silently handles already_exists error', async () => {
    const alreadyExistsErr = {
      _tag: 'InboxError',
      eventId: 'test-event-id',
      correlationId: null,
      code: 'already_exists' as const,
      message: 'duplicate',
    }
    const createInboxItem = vi.fn(async () => {
      throw alreadyExistsErr
    })
    const reviewLookup = {
      getReviewSnippetById: vi.fn(async () => ({
        reviewerName: null,
        text: null,
        reviewerProfilePhotoUrl: null,
      })),
      getReviewSnippetsByIds: vi.fn(async () => new Map()),
    } satisfies ReviewLookupPort

    await expect(
      onReviewCreated({
        createInboxItem: createInboxItem as unknown as CreateInboxItem,
        reviewLookup,
      })(mockEvent),
    ).resolves.toBeUndefined()
  })
})
