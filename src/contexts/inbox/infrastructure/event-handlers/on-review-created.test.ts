// Inbox context — on-review-created event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onReviewCreated } from './on-review-created'
import type { CreateInboxItemUseCase } from '../../application/use-cases/create-inbox-item'
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
  reviewText: 'Nice hotel',
  reviewerName: 'Test Reviewer',
  occurredAt: NOW,
}

describe('onReviewCreated', () => {
  it('creates inbox item for the review', async () => {
    const createInboxItem = vi.fn(async () => ({}))
    const deps = { createInboxItem } as unknown as {
      createInboxItem: CreateInboxItemUseCase
    }

    await onReviewCreated(deps)(mockEvent)

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

  it('passes null snippet when reviewText is null', async () => {
    const createInboxItem = vi.fn(async () => ({}))
    const deps = { createInboxItem } as unknown as {
      createInboxItem: CreateInboxItemUseCase
    }

    const eventNoText: ReviewCreated = { ...mockEvent, reviewText: null }
    await onReviewCreated(deps)(eventNoText)

    expect(createInboxItem).toHaveBeenCalledWith(
      expect.objectContaining({ snippet: null }),
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
    const deps = { createInboxItem } as unknown as {
      createInboxItem: CreateInboxItemUseCase
    }

    await expect(onReviewCreated(deps)(mockEvent)).resolves.toBeUndefined()
  })

  it('does not throw on generic repo error', async () => {
    const createInboxItem = vi.fn(async () => {
      throw new Error('DB down')
    })
    const deps = { createInboxItem } as unknown as {
      createInboxItem: CreateInboxItemUseCase
    }

    await expect(onReviewCreated(deps)(mockEvent)).resolves.toBeUndefined()
  })
})
