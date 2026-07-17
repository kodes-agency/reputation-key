// BQR-2.4 — durable inbox consumers perform real projection work.
// BQC-1.2: review.updated has no consumer (denormalized copies are gone);
// created is an existence check + metadata-only create; expired just closes.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleInboxReviewCreated,
  handleInboxReviewExpired,
  type InboxConsumerDeps,
} from './outbox-consumers'
import type { ConsumerEvent } from '#/shared/outbox/dispatcher'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { OutboxRepository } from '#/shared/outbox'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '../application/ports/review-lookup.port'
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

const AVAILABLE_SNIPPET: ReviewSnippetResult = {
  status: 'available',
  snippet: {
    text: 'Fresh text',
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 4,
  },
}

function makeDeps(overrides: {
  item?: InboxItem | null
  snippetResult?: ReviewSnippetResult
  createError?: unknown
}): InboxConsumerDeps {
  const item = overrides.item === undefined ? makeItem() : overrides.item

  const outboxRepo = {
    insert: vi.fn(async () => {}),
    claimUnpublished: vi.fn(async () => []),
    markPublished: vi.fn(async () => {}),
    hasReceipt: vi.fn(async () => false),
    insertReceipt: vi.fn(async () => {}),
    findExpiredLeases: vi.fn(async () => []),
  } satisfies OutboxRepository

  const inboxRepo = {
    findBySource: vi.fn(async () => item),
    updateStatus: vi.fn(async () => item ?? makeItem({ status: 'closed' })),
  } as unknown as InboxRepository

  const reviewLookup = {
    getReviewSnippetById: vi.fn(async () =>
      overrides.snippetResult === undefined ? AVAILABLE_SNIPPET : overrides.snippetResult,
    ),
    getReviewSnippetsByIds: vi.fn(async () => new Map()),
    findEligibleReviewIds: vi.fn(async () => []),
  } satisfies ReviewLookupPort

  const events = {
    on: vi.fn(),
    emit: vi.fn(async () => {}),
    clear: vi.fn(),
  } satisfies EventBus

  const createInboxItem = vi.fn(async () => {
    if (overrides.createError) throw overrides.createError
    return makeItem()
  })

  return {
    outboxRepo,
    reviewLookup,
    createInboxItem: createInboxItem as unknown as InboxConsumerDeps['createInboxItem'],
    inboxRepo,
    events,
    clock: () => NOW,
  }
}

describe('handleInboxReviewCreated (BQR-2.4 / BQC-1.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks obsolete when the review does not exist', async () => {
    const deps = makeDeps({ snippetResult: { status: 'not_found' } })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(deps.createInboxItem).not.toHaveBeenCalled()
    expect(deps.outboxRepo.insertReceipt).toHaveBeenCalledWith(
      'evt-1',
      'inbox.on-review-created',
      'obsolete',
    )
  })

  it('creates a metadata-only inbox item when content is available', async () => {
    const deps = makeDeps({ snippetResult: AVAILABLE_SNIPPET })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        occurredAt: NOW.toISOString(),
        platform: 'google',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(deps.reviewLookup.getReviewSnippetById).toHaveBeenCalledWith(REV, ORG)
    // BQC-1.2: metadata only — no rating/snippet/reviewerName copied.
    expect(deps.createInboxItem).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: PROP,
      sourceType: 'review',
      sourceId: REV,
      sourceDate: NOW,
      platform: 'google',
    })
    expect(deps.outboxRepo.insertReceipt).toHaveBeenCalledWith(
      'evt-1',
      'inbox.on-review-created',
      'applied',
    )
  })

  it('still creates a metadata-only item when content is expired', async () => {
    const deps = makeDeps({ snippetResult: { status: 'expired' } })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(deps.createInboxItem).toHaveBeenCalled()
    expect(deps.outboxRepo.insertReceipt).toHaveBeenCalledWith(
      'evt-1',
      'inbox.on-review-created',
      'applied',
    )
  })

  it('marks duplicate when the inbox item already exists', async () => {
    const deps = makeDeps({
      createError: {
        _tag: 'InboxError',
        code: 'already_exists',
        message: 'duplicate',
      },
    })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'duplicate' })
    expect(deps.outboxRepo.insertReceipt).toHaveBeenCalledWith(
      'evt-1',
      'inbox.on-review-created',
      'duplicate',
    )
  })
})

describe('handleInboxReviewExpired (BQR-2.4 / BQC-1.2)', () => {
  it('closes the open inbox item and records applied', async () => {
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
    expect(deps.inboxRepo.findBySource).toHaveBeenCalledWith('review', 'rev-1', ORG)
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

  it('applies without a status re-write when the item is already closed', async () => {
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
  })
})
