import { describe, it, expect, vi } from 'vitest'
import { onReviewExpired } from './on-review-expired'
import type { ReviewExpired } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { InboxItem } from '../../domain/types'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { createMockLogger } from '#/shared/testing/mock-logger'

const NOW = new Date('2026-06-15T12:00:00Z')
const ORG_ID = organizationId('org-1')
const REVIEW_ID = reviewId('rev-1')

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: inboxItemId('inbox-1'),
    organizationId: ORG_ID,
    propertyId: propertyId('prop-1'),
    sourceType: 'review',
    sourceId: REVIEW_ID,
    status: 'open',
    rating: null,
    sourceDate: new Date('2026-06-01'),
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<ReviewExpired> = {}): ReviewExpired {
  return {
    _tag: 'review.expired',
    eventId: 'evt-1',
    reviewId: REVIEW_ID,
    propertyId: propertyId('prop-1'),
    organizationId: ORG_ID,
    occurredAt: NOW,
    correlationId: null,
    ...overrides,
  }
}

describe('onReviewExpired', () => {
  it('scrubs legacy provider copies without changing workflow status', async () => {
    const item = makeItem()
    const clearReviewSourceContent = vi.fn(async () => item)

    const deps = {
      repo: {
        findBySource: vi.fn(async () => item),
        clearReviewSourceContent,
      } as unknown as InboxRepository,
      logger: createMockLogger(),
    }

    await onReviewExpired(deps)(makeEvent())

    expect(deps.repo.findBySource).toHaveBeenCalledWith('review', 'rev-1', ORG_ID)
    expect(clearReviewSourceContent).toHaveBeenCalledWith(
      inboxItemId('inbox-1'),
      ORG_ID,
      NOW,
    )
  })

  it('also scrubs an already-closed item', async () => {
    const item = makeItem({ status: 'closed', closedAt: NOW })
    const clearReviewSourceContent = vi.fn(async () => item)

    const deps = {
      repo: {
        findBySource: vi.fn(async () => item),
        clearReviewSourceContent,
      } as unknown as InboxRepository,
      logger: createMockLogger(),
    }

    await onReviewExpired(deps)(makeEvent())

    expect(clearReviewSourceContent).toHaveBeenCalledWith(item.id, ORG_ID, NOW)
  })

  it('skips silently when no inbox item exists for the review', async () => {
    const clearReviewSourceContent = vi.fn()

    const deps = {
      repo: {
        findBySource: vi.fn(async () => null),
        clearReviewSourceContent,
      } as unknown as InboxRepository,
      logger: createMockLogger(),
    }

    await expect(onReviewExpired(deps)(makeEvent())).resolves.toBeUndefined()
    expect(clearReviewSourceContent).not.toHaveBeenCalled()
  })

  it('does not throw on repo error', async () => {
    const deps = {
      repo: {
        findBySource: vi.fn(async () => {
          throw new Error('DB down')
        }),
      } as unknown as InboxRepository,
      logger: createMockLogger(),
    }

    await expect(onReviewExpired(deps)(makeEvent())).resolves.toBeUndefined()
  })
})
