// Inbox context — on-review-updated event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onReviewUpdated } from './on-review-updated'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { InboxItem } from '../../application/public-api'
import type { ReviewUpdated } from '#/contexts/review/application/public-api'
import { inboxItemId, organizationId, reviewId, propertyId } from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const REVIEW_ID = reviewId('rev-1')
const PROP_ID = propertyId('prop-1')
const INBOX_ID = inboxItemId('inbox-1')
const NOW = new Date('2025-06-01T12:00:00Z')

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: INBOX_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    sourceType: 'review',
    sourceId: REVIEW_ID,
    platform: 'google',
    snippet: 'Great stay',
    rating: 5,
    status: 'new',
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    sourceDate: NOW,
    readAt: null,
    escalatedAt: null,
    addressedAt: null,
    archivedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const mockEvent: ReviewUpdated = {
  _tag: 'review.updated',
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  platform: 'google',
  externalId: 'ext-1',
  rating: 3,
  reviewText: 'Updated review text',
  occurredAt: NOW,
}

describe('onReviewUpdated', () => {
  it('syncs denormalized fields on matching inbox item', async () => {
    const item = makeInboxItem()
    const repo = {
      findBySource: vi.fn(async () => item),
      syncDenormalizedFields: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await onReviewUpdated({ repo })(mockEvent)

    expect(repo.findBySource).toHaveBeenCalledWith('review', 'rev-1', ORG_ID)
    expect(repo.syncDenormalizedFields).toHaveBeenCalledWith(INBOX_ID, ORG_ID, {
      rating: 3,
      snippet: 'Updated review text',
    })
  })

  it('passes undefined snippet when reviewText is null', async () => {
    const item = makeInboxItem()
    const repo = {
      findBySource: vi.fn(async () => item),
      syncDenormalizedFields: vi.fn(async () => {}),
    } as unknown as InboxRepository

    const eventNullText: ReviewUpdated = { ...mockEvent, reviewText: null }
    await onReviewUpdated({ repo })(eventNullText)

    expect(repo.syncDenormalizedFields).toHaveBeenCalledWith(INBOX_ID, ORG_ID, {
      rating: 3,
      snippet: undefined,
    })
  })

  it('skips if no inbox item found', async () => {
    const repo = {
      findBySource: vi.fn(async () => null),
      syncDenormalizedFields: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await onReviewUpdated({ repo })(mockEvent)

    expect(repo.syncDenormalizedFields).not.toHaveBeenCalled()
  })

  it('does not throw on repo error', async () => {
    const repo = {
      findBySource: vi.fn(async () => {
        throw new Error('DB down')
      }),
      syncDenormalizedFields: vi.fn(async () => {}),
    } as unknown as InboxRepository

    await expect(onReviewUpdated({ repo })(mockEvent)).resolves.toBeUndefined()
  })

  it('does not throw when syncDenormalizedFields fails', async () => {
    const item = makeInboxItem()
    const repo = {
      findBySource: vi.fn(async () => item),
      syncDenormalizedFields: vi.fn(async () => {
        throw new Error('Write failed')
      }),
    } as unknown as InboxRepository

    await expect(onReviewUpdated({ repo })(mockEvent)).resolves.toBeUndefined()
  })
})
