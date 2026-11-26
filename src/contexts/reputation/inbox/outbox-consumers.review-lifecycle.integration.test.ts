// Durable inbox consumers for the Review lifecycle (created, expired, source
// transitioned, updated) apply projections via applyOnce. Duplicate deliveries
// record receipts without second facts; missing items/reviews are applied
// no-ops (rebuild heals).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleInboxReviewCreated,
  handleInboxReviewExpired,
  handleInboxReviewSourceTransitioned,
  handleInboxReviewUpdated,
} from './outbox-consumers.server'
import {
  AVAILABLE_SNIPPET,
  EVENT_ID,
  INBOX,
  NOW,
  ORG,
  PROP,
  REV,
  SOURCE_META,
  makeDeps,
  makeItem,
  pool,
  reviewEvent,
  useOutboxConsumersDatabase,
} from './outbox-consumers.test-fixtures'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

useOutboxConsumersDatabase()

const TRANSITIONED_RECEIPT = 'inbox.on-review-source-transitioned'

const transitionedEvent = (extra: Record<string, unknown> = {}) =>
  reviewEvent('review.source_transitioned', {
    sourceEpoch: 1,
    sourceRevision: 2,
    analysisSequence: 2,
    change: 'source_expired',
    occurredAt: NOW.toISOString(),
    ...extra,
  })

describe('handleInboxReviewCreated (BQC-3.4 applyOnce)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks obsolete when the review does not exist', async () => {
    const { deps, expectReceipt } = await makeDeps({
      snippetResult: { status: 'not_found' },
    })
    const result = await handleInboxReviewCreated(deps, reviewEvent('review.created'))

    expect(result).toEqual({ status: 'obsolete' })
    await expectReceipt('inbox.on-review-created', 'obsolete')
  })

  it('creates a metadata-only item + created fact + applied receipt in one apply', async () => {
    const { deps, repo, events, expectReceipt } = await makeDeps({
      item: null,
      snippetResult: AVAILABLE_SNIPPET,
    })
    const apply = vi.spyOn(deps.commandStore, 'applyReviewProjectionOnce')
    const result = await handleInboxReviewCreated(
      deps,
      reviewEvent('review.created', {
        occurredAt: NOW.toISOString(),
        platform: 'google',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    // Metadata only — no rating/snippet/reviewerName copied.
    expect(await repo.items()).toHaveLength(1)
    const stored = await repo.first()
    expect(stored.sourceDate).toEqual(SOURCE_META.sourceDate)
    expect(stored.platform).toBe('google')
    expect(stored.rating).toBeNull()
    expect(stored.snippet).toBeNull()
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(1)
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'created',
        projection: expect.objectContaining({
          authority: 'review.current-inbox-projection.v1',
          currentMaterialReviewRevision: 1,
          revisions: [
            expect.objectContaining({
              authority: 'review.inbox-projection-revision.v1',
              materialReviewRevision: 1,
              eligibility: 'measured',
              responseTargetStartAt: SOURCE_META.sourceDate,
            }),
          ],
        }),
      }),
      // The fake authority lends no Review transaction.
      undefined,
    )
    await expectReceipt('inbox.on-review-created', 'applied')
  })

  it('still creates a metadata-only item when content is expired', async () => {
    const { deps, repo } = await makeDeps({
      item: null,
      snippetResult: { status: 'expired' },
    })
    const result = await handleInboxReviewCreated(deps, reviewEvent('review.created'))

    expect(result).toEqual({ status: 'applied' })
    expect(await repo.items()).toHaveLength(1)
  })

  it('duplicate delivery: duplicate receipt, no second item, no second fact', async () => {
    const { deps, repo, events, expectReceipt } = await makeDeps({ item: makeItem() })
    const result = await handleInboxReviewCreated(deps, reviewEvent('review.created'))

    expect(result).toEqual({ status: 'duplicate' })
    expect(await repo.items()).toHaveLength(1)
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(0)
    await expectReceipt('inbox.on-review-created', 'duplicate')
  })
})

describe('handleInboxReviewExpired (BQC-3.4 applyOnce)', () => {
  it('the database refuses provider text on a review item, so none can be restored', async () => {
    await makeDeps({})

    await expect(
      pool.query(
        `UPDATE inbox_items SET rating = 2, snippet = 'restored provider review text',
                reviewer_name = 'Restored guest' WHERE id = $1`,
        [INBOX],
      ),
    ).rejects.toMatchObject({ constraint: 'inbox_items_review_source_content_free' })
  })

  it.each([
    [
      'scrubs legacy content but never stale-closes current work',
      makeItem,
      { status: 'open', closedAt: null },
    ],
    [
      'already closed: scrubs restored legacy content without a false status fact',
      () => makeItem({ status: 'closed' }),
      { id: INBOX, status: 'closed' },
    ],
  ] as const)('%s', async (_title, buildItem, expected) => {
    const { deps, repo, events, expectReceipt } = await makeDeps({ item: buildItem() })
    const result = await handleInboxReviewExpired(deps, reviewEvent('review.expired'))

    expect(result).toEqual({ status: 'applied' })
    expect(await repo.first()).toMatchObject({
      ...expected,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    await expectReceipt('inbox.on-review-expired', 'applied')
  })

  it('applies when no inbox item exists', async () => {
    const { deps, receipts } = await makeDeps({ item: null })
    const result = await handleInboxReviewExpired(deps, reviewEvent('review.expired'))

    expect(result).toEqual({ status: 'applied' })
    expect(await receipts()).toHaveLength(1)
  })
})

describe('handleInboxReviewSourceTransitioned (REV-01 content-free handoff)', () => {
  it('preserves the Inbox identity while closing and scrubbing a legacy Review projection', async () => {
    const { deps, repo, events, expectReceipt, sourceTransitionAuthority } =
      await makeDeps({ item: makeItem() })

    const result = await handleInboxReviewSourceTransitioned(deps, transitionedEvent())

    expect(result).toEqual({ status: 'applied' })
    expect(sourceTransitionAuthority.withExactCurrent).toHaveBeenCalledWith(
      {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW,
      },
      expect.any(Function),
    )
    expect(await repo.items()).toHaveLength(1)
    expect(await repo.first()).toMatchObject({
      id: INBOX,
      sourceId: REV,
      status: 'closed',
      closedAt: NOW,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    await expectReceipt(TRANSITIONED_RECEIPT, 'applied')
  })

  it('receipts a stale transition as obsolete without changing a re-observed Inbox item', async () => {
    const { deps, repo, events, expectReceipt } = await makeDeps({
      sourceTransitionCurrent: false,
      item: makeItem({
        rating: null,
        snippet: null,
        reviewerName: null,
      }),
    })

    const result = await handleInboxReviewSourceTransitioned(deps, transitionedEvent())

    expect(result).toEqual({ status: 'obsolete' })
    expect(await repo.first()).toMatchObject({
      id: INBOX,
      status: 'open',
      closedAt: null,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    await expectReceipt(TRANSITIONED_RECEIPT, 'obsolete')
  })

  it('stays retryable when it overtakes creation of the stable Inbox identity', async () => {
    const { deps, expectNoReceipts } = await makeDeps({ item: null })

    await expect(
      handleInboxReviewSourceTransitioned(
        deps,
        transitionedEvent({ change: 'provider_deleted' }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    await expectNoReceipts()
  })

  it('marks obsolete when both the Inbox item and stable Review identity are gone', async () => {
    const { deps, expectReceipt } = await makeDeps({
      item: null,
      sourceTransitionCurrent: false,
    })

    await expect(
      handleInboxReviewSourceTransitioned(
        deps,
        transitionedEvent({ change: 'provider_deleted' }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })

    await expectReceipt(TRANSITIONED_RECEIPT, 'obsolete')
  })

  it('rejects cross-Property envelope attribution before any Inbox mutation', async () => {
    const { deps, repo, expectNoReceipts } = await makeDeps({ item: makeItem() })
    const event = transitionedEvent({ propertyId: 'different-property' })

    await expect(handleInboxReviewSourceTransitioned(deps, event)).rejects.toThrow(
      'envelope attribution',
    )
    expect(await repo.first()).toMatchObject({
      status: 'open',
      closedAt: null,
      commandRevision: 1,
    })
    await expectNoReceipts()
  })
})

describe('handleInboxReviewUpdated (BQC-3.4 — BQC-3.1 orphan resolved)', () => {
  it('delegates a Material Review Revision advance to the atomic command', async () => {
    const { deps } = await makeDeps({
      sourceMeta: { ...SOURCE_META, materialReviewRevision: 2 },
    })
    const apply = vi.spyOn(deps.commandStore, 'applyReviewProjectionOnce')
    const event = reviewEvent('review.updated', { sourceRevision: 2 })

    await handleInboxReviewUpdated(deps, event)

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        consumerName: 'inbox.on-review-updated',
        eventKind: 'updated',
        item: expect.objectContaining({ id: INBOX, sourceId: REV }),
        projection: expect.objectContaining({
          currentMaterialReviewRevision: 2,
          revisions: [
            expect.objectContaining({ materialReviewRevision: 1 }),
            expect.objectContaining({ materialReviewRevision: 2 }),
          ],
        }),
        now: NOW,
      }),
      // The fake authority lends no Review transaction.
      undefined,
    )
  })

  it('refreshes sourceDate/platform metadata and records the receipt', async () => {
    const { deps, repo, expectReceipt } = await makeDeps({})
    const result = await handleInboxReviewUpdated(deps, reviewEvent('review.updated'))

    expect(result).toEqual({ status: 'applied' })
    const stored = await repo.first()
    expect(stored.sourceDate).toEqual(SOURCE_META.sourceDate)
    expect(stored.platform).toBe('google')
    await expectReceipt('inbox.on-review-updated', 'applied')
  })

  it('missing item: bootstraps the stable item and records the update receipt', async () => {
    const { deps, repo, events, expectReceipt } = await makeDeps({ item: null })
    const result = await handleInboxReviewUpdated(deps, reviewEvent('review.updated'))

    expect(result).toEqual({ status: 'applied' })
    expect(await repo.items()).toHaveLength(1)
    expect(await repo.first()).toMatchObject({ sourceType: 'review', sourceId: REV })
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(1)
    await expectReceipt('inbox.on-review-updated', 'applied')
  })

  it('missing Review authority: records an obsolete receipt', async () => {
    const { deps, repo, expectReceipt } = await makeDeps({ sourceMeta: null })
    const result = await handleInboxReviewUpdated(deps, reviewEvent('review.updated'))

    expect(result).toEqual({ status: 'obsolete' })
    expect((await repo.first()).sourceDate).toEqual(new Date('2026-06-01'))
    await expectReceipt('inbox.on-review-updated', 'obsolete')
  })
})
