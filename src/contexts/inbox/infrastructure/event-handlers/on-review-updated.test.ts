// Inbox context — on-review-updated event handler tests

import { describe, it, expect, vi } from 'vitest'
import { onReviewUpdated } from './on-review-updated'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { ReviewLookupPort } from '../../application/ports/review-lookup.port'
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
    status: 'open',
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    sourceDate: NOW,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const mockEvent: ReviewUpdated = {
  _tag: 'review.updated',
  eventId: 'test-event-id',
  correlationId: null,
  reviewId: REVIEW_ID,
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  platform: 'google',
  externalId: 'ext-1',
  rating: 3,
  occurredAt: NOW,
}

describe('onReviewUpdated', () => {
  it('syncs denormalized fields from review lookup (BQR-4.2)', async () => {
    const item = makeInboxItem()
    const repo = {
      findBySource: vi.fn(async () => item),
      syncDenormalizedFields: vi.fn(async () => {}),
    } as unknown as InboxRepository
    const reviewLookup = {
      getReviewSnippetById: vi.fn(async () => ({
        reviewerName: null,
        text: 'Updated review text',
        reviewerProfilePhotoUrl: null,
      })),
      getReviewSnippetsByIds: vi.fn(async () => new Map()),
    } satisfies ReviewLookupPort

    await onReviewUpdated({ repo, reviewLookup })(mockEvent)

    expect(repo.findBySource).toHaveBeenCalledWith('review', 'rev-1', ORG_ID)
    expect(reviewLookup.getReviewSnippetById).toHaveBeenCalledWith(REVIEW_ID, ORG_ID)
    expect(repo.syncDenormalizedFields).toHaveBeenCalledWith(INBOX_ID, ORG_ID, {
      rating: 3,
      snippet: 'Updated review text',
      reviewerName: null,
    })
  })

  it('passes undefined snippet when lookup text is null', async () => {
    const item = makeInboxItem()
    const repo = {
      findBySource: vi.fn(async () => item),
      syncDenormalizedFields: vi.fn(async () => {}),
    } as unknown as InboxRepository
    const reviewLookup = {
      getReviewSnippetById: vi.fn(async () => ({
        reviewerName: null,
        text: null,
        reviewerProfilePhotoUrl: null,
      })),
      getReviewSnippetsByIds: vi.fn(async () => new Map()),
    } satisfies ReviewLookupPort

    await onReviewUpdated({ repo, reviewLookup })(mockEvent)

    expect(repo.syncDenormalizedFields).toHaveBeenCalledWith(INBOX_ID, ORG_ID, {
      rating: 3,
      snippet: undefined,
      reviewerName: null,
    })
  })

  it('skips if no inbox item found', async () => {
    const repo = {
      findBySource: vi.fn(async () => null),
      syncDenormalizedFields: vi.fn(async () => {}),
    } as unknown as InboxRepository
    const reviewLookup = {
      getReviewSnippetById: vi.fn(async () => null),
      getReviewSnippetsByIds: vi.fn(async () => new Map()),
    } satisfies ReviewLookupPort

    await onReviewUpdated({ repo, reviewLookup })(mockEvent)

    expect(repo.syncDenormalizedFields).not.toHaveBeenCalled()
    expect(reviewLookup.getReviewSnippetById).not.toHaveBeenCalled()
  })
})
