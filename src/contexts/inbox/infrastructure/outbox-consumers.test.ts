// BQC-3.4 — durable inbox consumers apply projections via applyOnce:
// state change, emitted facts, and the receipt co-commit through the inbox
// command store. Duplicate deliveries record receipts without second facts;
// missing items/reviews are applied no-ops (rebuild heals).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleInboxReviewCreated,
  handleInboxReviewExpired,
  handleInboxReviewUpdated,
  handleInboxReplyPublished,
  type InboxConsumerDeps,
} from './outbox-consumers'
import type { ConsumerEvent } from '#/shared/outbox/dispatcher'
import { createInMemoryInboxRepo } from '#/shared/testing/in-memory-inbox-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createSequentialInboxCommandStore } from '#/shared/testing/sequential-inbox-command-store'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '../application/ports/review-lookup.port'
import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from '../application/ports/review-source-lookup.port'
import type { ApplyReceiptStatus } from '../application/ports/inbox-command-store.port'
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

const SOURCE_META: ReviewSourceMeta = {
  id: REV,
  propertyId: PROP,
  platform: 'google',
  sourceDate: new Date('2026-06-10'),
  contentExpiresAt: null,
}

type ReceiptRow = Readonly<{
  eventId: string
  consumerName: string
  status: ApplyReceiptStatus
}>

function makeDeps(overrides: {
  item?: InboxItem | null
  snippetResult?: ReviewSnippetResult
  sourceMeta?: ReviewSourceMeta | null
}) {
  const item = overrides.item === undefined ? makeItem() : overrides.item
  const repo = createInMemoryInboxRepo()
  if (item) repo.items.push(item)
  const events = createCapturingEventBus()
  const receipts: ReceiptRow[] = []
  const commandStore = createSequentialInboxCommandStore({
    repo,
    events,
    recordReceipt: async (eventId, consumerName, status) => {
      receipts.push({ eventId, consumerName, status })
    },
  })

  const reviewLookup = {
    getReviewSnippetById: vi.fn(async () =>
      overrides.snippetResult === undefined ? AVAILABLE_SNIPPET : overrides.snippetResult,
    ),
    getReviewSnippetsByIds: vi.fn(async () => new Map()),
    findEligibleReviewIds: vi.fn(async () => []),
  } satisfies ReviewLookupPort

  const reviewSourceLookup = {
    getReviewSourceMetaById: vi.fn(async () =>
      overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta,
    ),
    listReviewSources: vi.fn(async () => []),
  } satisfies ReviewSourceLookupPort

  const deps: InboxConsumerDeps = {
    commandStore,
    reviewLookup,
    reviewSourceLookup,
    inboxRepo: repo,
    idGen: () => INBOX,
    clock: () => NOW,
  }
  return { deps, repo, events, receipts }
}

describe('handleInboxReviewCreated (BQC-3.4 applyOnce)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks obsolete when the review does not exist', async () => {
    const { deps, receipts } = makeDeps({ snippetResult: { status: 'not_found' } })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-created', status: 'obsolete' },
    ])
  })

  it('creates a metadata-only item + created fact + applied receipt in one apply', async () => {
    const { deps, repo, events, receipts } = makeDeps({
      item: null,
      snippetResult: AVAILABLE_SNIPPET,
    })
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
    expect(repo.items).toHaveLength(1)
    expect(repo.items[0]!.sourceDate).toEqual(NOW)
    expect(repo.items[0]!.platform).toBe('google')
    expect(repo.items[0]!.rating).toBeNull()
    expect(repo.items[0]!.snippet).toBeNull()
    expect(events.capturedByTag('inbox.inbox_item.created')).toHaveLength(1)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-created', status: 'applied' },
    ])
  })

  it('still creates a metadata-only item when content is expired', async () => {
    const { deps, repo } = makeDeps({ item: null, snippetResult: { status: 'expired' } })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items).toHaveLength(1)
  })

  it('duplicate delivery: duplicate receipt, no second item, no second fact', async () => {
    const { deps, repo, events, receipts } = makeDeps({ item: makeItem() })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'duplicate' })
    expect(repo.items).toHaveLength(1)
    expect(events.capturedByTag('inbox.inbox_item.created')).toHaveLength(0)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-created', status: 'duplicate' },
    ])
  })
})

describe('handleInboxReviewExpired (BQC-3.4 applyOnce)', () => {
  it('closes the open item, emits the fact, and records the receipt atomically', async () => {
    const { deps, repo, events, receipts } = makeDeps({})
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]!.status).toBe('closed')
    expect(repo.items[0]!.closedAt).toEqual(NOW)
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-expired', status: 'applied' },
    ])
  })

  it('already closed: receipt recorded, no second status_changed fact', async () => {
    const { deps, events, receipts } = makeDeps({ item: makeItem({ status: 'closed' }) })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-expired', status: 'applied' },
    ])
  })

  it('applies when no inbox item exists', async () => {
    const { deps, receipts } = makeDeps({ item: null })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(receipts).toHaveLength(1)
  })
})

describe('handleInboxReviewUpdated (BQC-3.4 — BQC-3.1 orphan resolved)', () => {
  it('refreshes sourceDate/platform metadata and records the receipt', async () => {
    const { deps, repo, receipts } = makeDeps({})
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]!.sourceDate).toEqual(SOURCE_META.sourceDate)
    expect(repo.items[0]!.platform).toBe('google')
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-updated', status: 'applied' },
    ])
  })

  it('missing item: applied no-op with a receipt (rebuild heals)', async () => {
    const { deps, repo, receipts } = makeDeps({ item: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items).toHaveLength(0)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-updated', status: 'applied' },
    ])
  })

  it('missing review row: applied no-op with a receipt', async () => {
    const { deps, repo, receipts } = makeDeps({ sourceMeta: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]!.sourceDate).toEqual(new Date('2026-06-01'))
    expect(receipts).toHaveLength(1)
  })
})

describe('handleInboxReplyPublished (BQC-3.4 durable milestone/auto-close)', () => {
  it('stamps firstReplyPublishedAt, closes the open item, emits the fact', async () => {
    const { deps, repo, events, receipts } = makeDeps({})
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]!.status).toBe('closed')
    expect(repo.items[0]!.closedAt).toEqual(NOW)
    expect(repo.items[0]!.firstReplyPublishedAt).toEqual(NOW)
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-published', status: 'applied' },
    ])
  })

  it('already closed but milestone missing: stamps only, no fact', async () => {
    const { deps, repo, events, receipts } = makeDeps({
      item: makeItem({ status: 'closed', closedAt: NOW }),
    })
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]!.firstReplyPublishedAt).toEqual(NOW)
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(receipts).toHaveLength(1)
  })

  it('already closed and stamped: receipt only', async () => {
    const stamped = new Date('2026-06-12')
    const { deps, repo, events, receipts } = makeDeps({
      item: makeItem({
        status: 'closed',
        closedAt: stamped,
        firstReplyPublishedAt: stamped,
      }),
    })
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]!.firstReplyPublishedAt).toEqual(stamped)
    expect(events.capturedEvents).toHaveLength(0)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-published', status: 'applied' },
    ])
  })

  it('missing item: applied no-op with a receipt', async () => {
    const { deps, receipts } = makeDeps({ item: null })
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-published', status: 'applied' },
    ])
  })
})
