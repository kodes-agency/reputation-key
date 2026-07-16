import { describe, it, expect, vi } from 'vitest'
import { onReviewExpired, scrubInboxSourceContent } from './on-review-expired'
import type { ReviewExpired } from '#/contexts/review/application/public-api'
import type { InboxRepository } from '../../application/ports/inbox.repository'
import type { InboxItem } from '../../domain/types'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

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
    rating: 4,
    sourceDate: new Date('2026-06-01'),
    platform: 'google',
    snippet: 'Nice place',
    assignedTo: null,
    reviewerName: 'John Doe',
    propertyName: null,
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

describe('scrubInboxSourceContent', () => {
  it('clears snippet and reviewerName via syncDenormalizedFields', async () => {
    const item = makeItem()
    const syncDenormalizedFields = vi.fn(async () => {})
    const repo = { syncDenormalizedFields } as unknown as InboxRepository

    await scrubInboxSourceContent(repo, item, NOW)

    expect(syncDenormalizedFields).toHaveBeenCalledWith(
      inboxItemId('inbox-1'),
      ORG_ID,
      { snippet: null, reviewerName: null },
      NOW,
    )
  })
})

describe('onReviewExpired', () => {
  it('scrubs raw content and closes inbox item when review is purged', async () => {
    const item = makeItem()
    const updateStatus = vi.fn(async () => item)
    const syncDenormalizedFields = vi.fn(async () => {})

    const deps = {
      repo: {
        findBySource: vi.fn(async () => item),
        updateStatus,
        syncDenormalizedFields,
      } as unknown as InboxRepository,
      events: {
        emit: vi.fn(async () => {}),
      } as unknown as import('#/shared/events/event-bus').EventBus,
    }

    await onReviewExpired(deps)(makeEvent())

    expect(deps.repo.findBySource).toHaveBeenCalledWith('review', 'rev-1', ORG_ID)
    expect(syncDenormalizedFields).toHaveBeenCalledWith(
      inboxItemId('inbox-1'),
      ORG_ID,
      { snippet: null, reviewerName: null },
      NOW,
    )
    expect(updateStatus).toHaveBeenCalledWith(
      inboxItemId('inbox-1'),
      ORG_ID,
      'closed',
      { closedAt: NOW },
      NOW,
    )
  })

  it('scrubs raw content even when item is already closed', async () => {
    const item = makeItem({ status: 'closed', closedAt: NOW })
    const updateStatus = vi.fn()
    const syncDenormalizedFields = vi.fn(async () => {})

    const deps = {
      repo: {
        findBySource: vi.fn(async () => item),
        updateStatus,
        syncDenormalizedFields,
      } as unknown as InboxRepository,
      events: {
        emit: vi.fn(async () => {}),
      } as unknown as import('#/shared/events/event-bus').EventBus,
    }

    await onReviewExpired(deps)(makeEvent())

    expect(syncDenormalizedFields).toHaveBeenCalledWith(
      inboxItemId('inbox-1'),
      ORG_ID,
      { snippet: null, reviewerName: null },
      NOW,
    )
    expect(updateStatus).not.toHaveBeenCalled()
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('skips silently when no inbox item exists for the review', async () => {
    const updateStatus = vi.fn()
    const syncDenormalizedFields = vi.fn()

    const deps = {
      repo: {
        findBySource: vi.fn(async () => null),
        updateStatus,
        syncDenormalizedFields,
      } as unknown as InboxRepository,
      events: {
        emit: vi.fn(async () => {}),
      } as unknown as import('#/shared/events/event-bus').EventBus,
    }

    await expect(onReviewExpired(deps)(makeEvent())).resolves.toBeUndefined()
    expect(updateStatus).not.toHaveBeenCalled()
    expect(syncDenormalizedFields).not.toHaveBeenCalled()
  })

  it('does not throw on repo error', async () => {
    const deps = {
      repo: {
        findBySource: vi.fn(async () => {
          throw new Error('DB down')
        }),
      } as unknown as InboxRepository,
      events: {
        emit: vi.fn(async () => {}),
      } as unknown as import('#/shared/events/event-bus').EventBus,
    }

    await expect(onReviewExpired(deps)(makeEvent())).resolves.toBeUndefined()
  })
})
