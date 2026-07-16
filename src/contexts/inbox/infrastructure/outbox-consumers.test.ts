// BQR-2.4 — durable inbox consumers perform real projection work.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleInboxReviewUpdated,
  handleInboxReviewExpired,
  type InboxConsumerDeps,
} from './outbox-consumers'
import type { ConsumerEvent } from '#/shared/outbox/dispatcher'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { OutboxRepository } from '#/shared/outbox'
import type { ReviewLookupPort } from '../application/ports/review-lookup.port'
import type { EventBus } from '#/shared/events/event-bus'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { InboxItem } from '../domain/types'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

const NOW = new Date('2026-06-15T12:00:00Z')
const ORG = organizationId('org-1')
const PROP = propertyId('prop-1')
const REV = reviewId('rev-1')
const INBOX = inboxItemId('inbox-1')

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: INBOX,
    organizationId: ORG,
    propertyId: PROP,
    sourceType: 'review',
    sourceId: REV,
    status: 'open',
    rating: 4,
    sourceDate: new Date('2026-06-01'),
    platform: 'google',
    snippet: 'Old snippet',
    assignedTo: null,
    reviewerName: 'Old Name',
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

function makeEvent(eventType: string, payload: Record<string, unknown>): ConsumerEvent {
  return {
    eventId: 'evt-1',
    eventType,
    eventVersion: 1,
    payload,
    organizationId: 'org-1',
    propertyId: 'prop-1',
    sourceContext: 'review',
    sourceAggregateId: 'rev-1',
  }
}

function makeDeps(overrides: {
  item?: InboxItem | null
  snippet?: {
    text: string | null
    reviewerName: string | null
    reviewerProfilePhotoUrl: string | null
  } | null
}): InboxConsumerDeps {
  const item = overrides.item === undefined ? makeItem() : overrides.item

  const outboxRepo = {
    insert: vi.fn(async () => {}),
    claimUnpublished: vi.fn(async () => []),
    markPublished: vi.fn(async () => {}),
    hasReceipt: vi.fn(async () => false),
    insertReceipt: vi.fn(async () => {}),
    findExpiredLeases: vi.fn(async () => []),
    purgePublishedBefore: vi.fn(async () => 0),
    purgeReceiptsBefore: vi.fn(async () => 0),
  } satisfies OutboxRepository

  const inboxRepo = {
    findBySource: vi.fn(async () => item),
    syncDenormalizedFields: vi.fn(async () => {}),
    updateStatus: vi.fn(async () => item ?? makeItem({ status: 'closed' })),
  } as unknown as InboxRepository

  const defaultSnippet = {
    text: 'Fresh text',
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
  }

  const reviewLookup = {
    getReviewSnippetById: vi.fn(async () =>
      overrides.snippet === undefined ? defaultSnippet : overrides.snippet,
    ),
    getReviewSnippetsByIds: vi.fn(async () => new Map()),
  } satisfies ReviewLookupPort

  const events = {
    on: vi.fn(),
    emit: vi.fn(async () => {}),
    clear: vi.fn(),
  } satisfies EventBus

  return {
    outboxRepo,
    reviewLookup,
    createInboxItem: vi.fn(async () =>
      makeItem(),
    ) as unknown as InboxConsumerDeps['createInboxItem'],
    inboxRepo,
    events,
    clock: () => NOW,
  }
}

describe('handleInboxReviewUpdated (BQR-2.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('syncs denormalized fields from lookup + payload rating', async () => {
    const deps = makeDeps({})
    const event = makeEvent('review.updated', {
      reviewId: 'rev-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      rating: 2,
    })

    const result = await handleInboxReviewUpdated(deps, event)

    expect(result).toEqual({ status: 'applied' })
    expect(deps.inboxRepo.findBySource).toHaveBeenCalledWith('review', 'rev-1', ORG)
    expect(deps.reviewLookup.getReviewSnippetById).toHaveBeenCalled()
    expect(deps.inboxRepo.syncDenormalizedFields).toHaveBeenCalledWith(INBOX, ORG, {
      rating: 2,
      snippet: 'Fresh text',
      reviewerName: 'Jane',
    })
    expect(deps.outboxRepo.insertReceipt).toHaveBeenCalledWith(
      'evt-1',
      'inbox.on-review-updated',
      'applied',
    )
  })

  it('applies without sync when no inbox item exists', async () => {
    const deps = makeDeps({ item: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        rating: 5,
      }),
    )
    expect(result).toEqual({ status: 'applied' })
    expect(deps.inboxRepo.syncDenormalizedFields).not.toHaveBeenCalled()
  })

  it('marks obsolete when review content is gone', async () => {
    const deps = makeDeps({ snippet: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        rating: 5,
      }),
    )
    expect(result).toEqual({ status: 'obsolete' })
    expect(deps.outboxRepo.insertReceipt).toHaveBeenCalledWith(
      'evt-1',
      'inbox.on-review-updated',
      'obsolete',
    )
  })
})

describe('handleInboxReviewExpired (BQR-2.4 / BQR-3.3)', () => {
  it('scrubs raw content, closes open inbox item, and records applied', async () => {
    const deps = makeDeps({})
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(deps.inboxRepo.syncDenormalizedFields).toHaveBeenCalledWith(
      INBOX,
      ORG,
      { snippet: null, reviewerName: null },
      NOW,
    )
    expect(deps.inboxRepo.updateStatus).toHaveBeenCalledWith(
      INBOX,
      ORG,
      'closed',
      { closedAt: NOW },
      NOW,
    )
    expect(deps.events.emit).toHaveBeenCalled()
    expect(deps.outboxRepo.insertReceipt).toHaveBeenCalledWith(
      'evt-1',
      'inbox.on-review-expired',
      'applied',
    )
  })

  it('scrubs raw content when item already closed (no status re-write)', async () => {
    const deps = makeDeps({ item: makeItem({ status: 'closed' }) })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )
    expect(result).toEqual({ status: 'applied' })
    expect(deps.inboxRepo.syncDenormalizedFields).toHaveBeenCalledWith(
      INBOX,
      ORG,
      { snippet: null, reviewerName: null },
      NOW,
    )
    expect(deps.inboxRepo.updateStatus).not.toHaveBeenCalled()
  })

  it('applies when no inbox item exists', async () => {
    const deps = makeDeps({ item: null })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )
    expect(result).toEqual({ status: 'applied' })
    expect(deps.inboxRepo.updateStatus).not.toHaveBeenCalled()
    expect(deps.inboxRepo.syncDenormalizedFields).not.toHaveBeenCalled()
  })
})
