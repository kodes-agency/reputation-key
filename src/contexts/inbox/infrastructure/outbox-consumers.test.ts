// BQC-3.4 — durable inbox consumers apply projections via applyOnce:
// state change, emitted facts, and the receipt co-commit through the inbox
// command store. Duplicate deliveries record receipts without second facts;
// missing items/reviews are applied no-ops (rebuild heals).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleInboxReviewCreated,
  handleInboxReviewExpired,
  handleInboxReviewSourceTransitioned,
  handleInboxReviewUpdated,
  handleInboxReplyObserved,
  handleInboxReplyPublished,
  type InboxConsumerDeps,
} from './outbox-consumers'
import {
  handleInboxGuestFeedbackRetracted,
  handleInboxGuestFeedbackSubmitted,
} from './guest-feedback-outbox-consumers'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
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
import type { ReviewHandlingCycleStore } from '../application/ports/review-handling-cycle.store'
import type { ReplyObservationAuthorityPort } from '../application/ports/reply-observation-authority.port'
import type { SourceTransitionAuthorityPort } from '../application/ports/source-transition-authority.port'
import type {
  ReviewResponseTargetAuthorityPort,
  ReviewResponseTargetExpectation,
} from '../application/ports/review-response-target-authority.port'
import { createNextReviewHandlingCycle } from '../domain/handling-cycles'
import { inboxError } from '../domain/errors'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../domain/types'
import type {
  FeedbackLookupPort,
  FeedbackSnippet,
} from '../application/ports/feedback-lookup.port'
import { createMockLogger } from '#/shared/testing/mock-logger'

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
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeEvent(eventType: string, payload: Record<string, unknown>): ConsumerEvent {
  const versionedPayload =
    eventType === 'review.created' || eventType === 'review.updated'
      ? { sourceEpoch: 1, sourceRevision: 1, ...payload }
      : payload
  return {
    eventId: 'evt-1',
    eventType,
    eventVersion: 1,
    payload: versionedPayload,
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
    translatedText: null,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 4,
    languageCode: 'en',
  },
}

const SOURCE_META: ReviewSourceMeta = {
  id: REV,
  propertyId: PROP,
  platform: 'google',
  sourceEpoch: 1,
  sourceDate: new Date('2026-06-10'),
  contentExpiresAt: null,
  materialReviewRevision: 1,
}

const AVAILABLE_FEEDBACK: FeedbackSnippet = {
  comment: 'Private feedback',
  ratingValue: 2,
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
  feedback?: FeedbackSnippet | null
  observationCurrent?: boolean
  sourceEpochCarryFromMaterialReviewRevision?: number | null
  sourceTransitionCurrent?: boolean
  responseTargetCurrent?: boolean
  handlingCycleMissing?: boolean
  handlingCycleMaterialReviewRevision?: number
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
    getReviewSourceMetaByIds: vi.fn(async () => {
      const source =
        overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta
      return source ? [source] : []
    }),
    listReviewSources: vi.fn(async () => []),
  } satisfies ReviewSourceLookupPort

  const feedbackLookup = {
    getFeedbackSnippetById: vi.fn(async () =>
      overrides.feedback === undefined ? AVAILABLE_FEEDBACK : overrides.feedback,
    ),
    getFeedbackSnippetsByIds: vi.fn(async () => new Map()),
    findEligibleFeedbackIds: vi.fn(async () => []),
  } satisfies FeedbackLookupPort

  let handlingCycleHead =
    item?.sourceType === 'review' && overrides.handlingCycleMissing !== true
      ? {
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          reviewId: REV,
          currentCycleNumber: 1,
          currentMaterialReviewRevision:
            overrides.handlingCycleMaterialReviewRevision ?? 1,
          stateRevision: 1,
          status: item.status,
        }
      : null
  const handlingCycleStore = {
    findHead: vi.fn(async () => handlingCycleHead),
    listCycles: vi.fn(async () => []),
    startNext: vi.fn(async (command) => {
      if (handlingCycleHead === null) {
        throw inboxError('not_found', 'Handling Cycle head not found')
      }
      if (
        handlingCycleHead.currentCycleNumber !== command.expected.cycleNumber ||
        handlingCycleHead.currentMaterialReviewRevision !==
          command.expected.materialReviewRevision ||
        handlingCycleHead.stateRevision !== command.expected.stateRevision
      ) {
        throw inboxError('revision_conflict', 'Handling Cycle changed')
      }
      const result = createNextReviewHandlingCycle({
        current: handlingCycleHead,
        materialReviewRevision: command.materialReviewRevision,
        openedReason: command.openedReason,
        manualReopenReason: command.manualReopenReason,
        manualReopenExplanation: command.manualReopenExplanation,
        openedBy: command.openedBy,
        openedAt: command.openedAt,
      })
      if (result.isErr()) throw result.error
      handlingCycleHead = result.value.head
      return result.value
    }),
  } satisfies ReviewHandlingCycleStore

  const replyObservationAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.observationCurrent === false) {
        return { status: 'obsolete' as const }
      }
      return {
        status: 'current' as const,
        value: await apply({
          ...expectation,
          state: expectation.resolution === 'absent' ? 'absent' : 'live',
          observedAt: expectation.occurredAt,
          authority: 'review.current-google-reply-observation.v1',
          sourceEpochCarryFromMaterialReviewRevision:
            overrides.sourceEpochCarryFromMaterialReviewRevision ?? null,
          reviewSourceContentState: 'active',
          responseTargetEligibility: 'measured',
          responseTargetStartAt: SOURCE_META.sourceDate,
        }),
      }
    }),
  } satisfies ReplyObservationAuthorityPort

  const sourceTransitionAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.sourceTransitionCurrent === false) {
        return { status: 'obsolete' as const }
      }
      return {
        status: 'current' as const,
        value: await apply({
          ...expectation,
          authority: 'review.current-source-transition.v1',
        }),
      }
    }),
  } satisfies SourceTransitionAuthorityPort

  const responseTargetAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.responseTargetCurrent === false) {
        return { status: 'obsolete' as const }
      }
      const meta = overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta
      return {
        status: 'current' as const,
        value: await apply({
          ...expectation,
          authority: 'review.current-response-target.v1',
          materialReviewRevision: meta?.materialReviewRevision ?? 1,
          eligibility: 'measured',
          responseTargetStartAt: meta?.sourceDate ?? NOW,
        }),
      }
    }),
    withExactCurrentBatch: vi.fn(async (expectations, apply) => {
      if (overrides.responseTargetCurrent === false) {
        return { status: 'obsolete' as const }
      }
      const meta = overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta
      return {
        status: 'current' as const,
        value: await apply(
          expectations.map((expectation: ReviewResponseTargetExpectation) => ({
            ...expectation,
            authority: 'review.current-response-target.v1' as const,
            materialReviewRevision: meta?.materialReviewRevision ?? 1,
            eligibility: 'measured' as const,
            responseTargetStartAt: meta?.sourceDate ?? NOW,
          })),
        ),
      }
    }),
    withInboxProjection: vi.fn(async (expectation, apply) => {
      if (
        overrides.responseTargetCurrent === false ||
        overrides.sourceMeta === null ||
        overrides.snippetResult?.status === 'not_found'
      ) {
        return { status: 'obsolete' as const }
      }
      const meta = overrides.sourceMeta ?? SOURCE_META
      const revisionCount = meta.materialReviewRevision ?? 1
      return {
        status: 'current' as const,
        value: await apply({
          authority: 'review.current-inbox-projection.v1',
          organizationId: expectation.organizationId,
          propertyId: expectation.propertyId,
          reviewId: expectation.reviewId,
          sourceEpoch: expectation.sourceEpoch,
          platform: 'google',
          sourceDate: meta.sourceDate,
          sourceContentState: 'active',
          sourceContentErasedAt: null,
          currentMaterialReviewRevision: revisionCount,
          revisions: Array.from({ length: revisionCount }, (_, index) => ({
            authority: 'review.inbox-projection-revision.v1' as const,
            organizationId: expectation.organizationId,
            propertyId: expectation.propertyId,
            reviewId: expectation.reviewId,
            sourceEpoch: expectation.sourceEpoch,
            materialReviewRevision: index + 1,
            eligibility: 'measured' as const,
            responseTargetStartAt: meta.sourceDate,
            observedAt: new Date(NOW.getTime() + index),
          })) as [
            {
              authority: 'review.inbox-projection-revision.v1'
              organizationId: string
              propertyId: string
              reviewId: string
              sourceEpoch: number
              materialReviewRevision: number
              eligibility: 'measured'
              responseTargetStartAt: Date
              observedAt: Date
            },
          ],
        }),
      }
    }),
  } satisfies ReviewResponseTargetAuthorityPort

  const deps: InboxConsumerDeps = {
    commandStore,
    handlingCycleStore,
    replyObservationAuthority,
    responseTargetAuthority,
    sourceTransitionAuthority,
    reviewLookup,
    reviewSourceLookup,
    inboxRepo: repo,
    idGen: () => INBOX,
    clock: () => NOW,
    logger: createMockLogger(),
  }
  const guestDeps = {
    commandStore,
    feedbackLookup,
    inboxRepo: repo,
    idGen: () => INBOX,
    clock: () => NOW,
  }
  return {
    deps,
    guestDeps,
    repo,
    events,
    receipts,
    handlingCycleStore,
    replyObservationAuthority,
    sourceTransitionAuthority,
    materializeHandlingCycle: (materializedItem: InboxItem) => {
      handlingCycleHead = {
        inboxItemId: materializedItem.id,
        organizationId: materializedItem.organizationId,
        propertyId: materializedItem.propertyId,
        reviewId: REV,
        currentCycleNumber: 1,
        currentMaterialReviewRevision: 1,
        stateRevision: 1,
        status: materializedItem.status,
      }
    },
  }
}

describe('handleInboxGuestFeedbackSubmitted (durable private feedback)', () => {
  it('creates a metadata-only feedback item and co-commits its receipt', async () => {
    const { guestDeps, repo, events, receipts } = makeDeps({ item: null })

    const result = await handleInboxGuestFeedbackSubmitted(
      guestDeps,
      makeEvent('guest.feedback.submitted', {
        feedbackId: 'feedback-1',
        ratingId: 'rating-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        portalId: 'portal-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(guestDeps.feedbackLookup.getFeedbackSnippetById).toHaveBeenCalledWith(
      feedbackId('feedback-1'),
      ORG,
    )
    expect(repo.items).toHaveLength(1)
    expect(repo.items[0]).toMatchObject({
      sourceType: 'feedback',
      sourceId: 'feedback-1',
      propertyId: PROP,
      sourceDate: NOW,
      platform: null,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(events.capturedByTag('inbox.inbox_item.created')).toHaveLength(1)
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-guest-feedback-submitted',
        status: 'applied',
      },
    ])
  })

  it('records an obsolete receipt when feedback was withdrawn before delivery', async () => {
    const { guestDeps, repo, receipts } = makeDeps({ item: null, feedback: null })

    const result = await handleInboxGuestFeedbackSubmitted(
      guestDeps,
      makeEvent('guest.feedback.submitted', {
        feedbackId: 'feedback-1',
        ratingId: null,
        organizationId: 'org-1',
        propertyId: 'prop-1',
        portalId: 'portal-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(repo.items).toHaveLength(0)
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-guest-feedback-submitted',
        status: 'obsolete',
      },
    ])
  })

  it('does not create work when retention already removed the private text', async () => {
    const { guestDeps, repo, receipts } = makeDeps({
      item: null,
      feedback: { comment: null, ratingValue: 2 },
    })

    await expect(
      handleInboxGuestFeedbackSubmitted(
        guestDeps,
        makeEvent('guest.feedback.submitted', {
          feedbackId: 'feedback-1',
          ratingId: 'rating-1',
          organizationId: 'org-1',
          propertyId: 'prop-1',
          portalId: 'portal-1',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(repo.items).toHaveLength(0)
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-guest-feedback-submitted',
        status: 'obsolete',
      },
    ])
  })

  it('rejects cross-tenant envelope attribution before reading feedback', async () => {
    const { guestDeps } = makeDeps({ item: null })
    const event = makeEvent('guest.feedback.submitted', {
      feedbackId: 'feedback-1',
      ratingId: null,
      organizationId: 'other-org',
      propertyId: 'prop-1',
      portalId: 'portal-1',
      occurredAt: NOW.toISOString(),
    })

    await expect(handleInboxGuestFeedbackSubmitted(guestDeps, event)).rejects.toThrow(
      'attribution',
    )
    expect(guestDeps.feedbackLookup.getFeedbackSnippetById).not.toHaveBeenCalled()
  })
})

describe('handleInboxGuestFeedbackRetracted (durable private feedback)', () => {
  it('closes an open feedback item and co-commits the status fact and receipt', async () => {
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: feedbackId('feedback-1'),
      platform: null,
    })
    const { guestDeps, repo, events, receipts } = makeDeps({ item })

    const result = await handleInboxGuestFeedbackRetracted(
      guestDeps,
      makeEvent('guest.feedback.retracted', {
        feedbackId: 'feedback-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        portalId: 'portal-1',
        supersedesSourceEventId: 'source-event-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]).toMatchObject({ status: 'closed', closedAt: NOW })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toMatchObject([
      { oldStatus: 'open', newStatus: 'closed' },
    ])
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-guest-feedback-retracted',
        status: 'applied',
      },
    ])
  })

  it('records an applied no-op when the item was never projected', async () => {
    const { guestDeps, receipts } = makeDeps({ item: null })

    await expect(
      handleInboxGuestFeedbackRetracted(
        guestDeps,
        makeEvent('guest.feedback.retracted', {
          feedbackId: 'feedback-1',
          organizationId: 'org-1',
          propertyId: 'prop-1',
          portalId: 'portal-1',
          supersedesSourceEventId: 'source-event-1',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-guest-feedback-retracted',
        status: 'applied',
      },
    ])
  })

  it('lets the cycle store decide closure when the compatibility row is already closed', async () => {
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: feedbackId('feedback-1'),
      platform: null,
      status: 'closed',
      closedAt: new Date('2026-06-14T12:00:00Z'),
    })
    const { guestDeps } = makeDeps({ item })
    const apply = vi
      .spyOn(guestDeps.commandStore, 'applySourceWithdrawnOnce')
      .mockResolvedValue('applied')

    await handleInboxGuestFeedbackRetracted(
      guestDeps,
      makeEvent('guest.feedback.retracted', {
        feedbackId: 'feedback-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        portalId: 'portal-1',
        supersedesSourceEventId: 'source-event-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        item,
        fact: expect.objectContaining({ oldStatus: 'open', newStatus: 'closed' }),
      }),
    )
  })

  it('fails closed when the projected item belongs to a different Property', async () => {
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: feedbackId('feedback-1'),
      propertyId: propertyId('prop-2'),
      platform: null,
    })
    const { guestDeps, receipts } = makeDeps({ item })

    await expect(
      handleInboxGuestFeedbackRetracted(
        guestDeps,
        makeEvent('guest.feedback.retracted', {
          feedbackId: 'feedback-1',
          organizationId: 'org-1',
          propertyId: 'prop-1',
          portalId: 'portal-1',
          supersedesSourceEventId: 'source-event-1',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).rejects.toThrow('scope does not match')
    expect(receipts).toEqual([])
  })
})

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
    const apply = vi.spyOn(deps.commandStore, 'applyReviewProjectionOnce')
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
    expect(deps.reviewLookup.getReviewSnippetById).not.toHaveBeenCalled()
    // BQC-1.2: metadata only — no rating/snippet/reviewerName copied.
    expect(repo.items).toHaveLength(1)
    expect(repo.items[0]!.sourceDate).toEqual(SOURCE_META.sourceDate)
    expect(repo.items[0]!.platform).toBe('google')
    expect(repo.items[0]!.rating).toBeNull()
    expect(repo.items[0]!.snippet).toBeNull()
    expect(events.capturedByTag('inbox.inbox_item.created')).toHaveLength(1)
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
    )
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
  it('scrubs legacy content but never stale-closes current work', async () => {
    const { deps, repo, events, receipts } = makeDeps({
      item: makeItem({
        rating: 2,
        snippet: 'restored provider review text',
        reviewerName: 'Restored guest',
      }),
    })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]).toMatchObject({
      status: 'open',
      closedAt: null,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-expired', status: 'applied' },
    ])
  })

  it('already closed: scrubs restored legacy content without a false status fact', async () => {
    const { deps, repo, events, receipts } = makeDeps({
      item: makeItem({
        status: 'closed',
        rating: 2,
        snippet: 'restored provider review text',
        reviewerName: 'Restored guest',
      }),
    })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]).toMatchObject({
      id: INBOX,
      status: 'closed',
      rating: null,
      snippet: null,
      reviewerName: null,
    })
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

describe('handleInboxReviewSourceTransitioned (REV-01 content-free handoff)', () => {
  it('preserves the Inbox identity while closing and scrubbing a legacy Review projection', async () => {
    const { deps, repo, events, receipts, sourceTransitionAuthority } = makeDeps({
      item: makeItem({
        rating: 1,
        snippet: 'legacy provider-controlled review text',
        reviewerName: 'Legacy guest',
      }),
    })

    const result = await handleInboxReviewSourceTransitioned(
      deps,
      makeEvent('review.source_transitioned', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(sourceTransitionAuthority.withExactCurrent).toHaveBeenCalledWith(
      {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW,
      },
      expect.any(Function),
    )
    expect(repo.items).toHaveLength(1)
    expect(repo.items[0]).toMatchObject({
      id: INBOX,
      sourceId: REV,
      status: 'closed',
      closedAt: NOW,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-review-source-transitioned',
        status: 'applied',
      },
    ])
  })

  it('receipts a stale transition as obsolete without changing a re-observed Inbox item', async () => {
    const { deps, repo, events, receipts } = makeDeps({
      sourceTransitionCurrent: false,
      item: makeItem({
        rating: null,
        snippet: null,
        reviewerName: null,
      }),
    })

    const result = await handleInboxReviewSourceTransitioned(
      deps,
      makeEvent('review.source_transitioned', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(repo.items[0]).toMatchObject({
      id: INBOX,
      status: 'open',
      closedAt: null,
    })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-review-source-transitioned',
        status: 'obsolete',
      },
    ])
  })

  it('stays retryable when it overtakes creation of the stable Inbox identity', async () => {
    const { deps, receipts } = makeDeps({ item: null })

    await expect(
      handleInboxReviewSourceTransitioned(
        deps,
        makeEvent('review.source_transitioned', {
          reviewId: 'rev-1',
          organizationId: 'org-1',
          propertyId: 'prop-1',
          sourceEpoch: 1,
          sourceRevision: 2,
          analysisSequence: 2,
          change: 'provider_deleted',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(receipts).toEqual([])
  })

  it('marks obsolete when both the Inbox item and stable Review identity are gone', async () => {
    const { deps, receipts } = makeDeps({
      item: null,
      sourceTransitionCurrent: false,
    })

    await expect(
      handleInboxReviewSourceTransitioned(
        deps,
        makeEvent('review.source_transitioned', {
          reviewId: 'rev-1',
          organizationId: 'org-1',
          propertyId: 'prop-1',
          sourceEpoch: 1,
          sourceRevision: 2,
          analysisSequence: 2,
          change: 'provider_deleted',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-review-source-transitioned',
        status: 'obsolete',
      },
    ])
  })

  it('rejects cross-Property envelope attribution before any Inbox mutation', async () => {
    const { deps, repo, receipts } = makeDeps({
      item: makeItem({ snippet: 'legacy provider text' }),
    })
    const event = makeEvent('review.source_transitioned', {
      reviewId: 'rev-1',
      organizationId: 'org-1',
      propertyId: 'different-property',
      sourceEpoch: 1,
      sourceRevision: 2,
      analysisSequence: 2,
      change: 'source_expired',
      occurredAt: NOW.toISOString(),
    })

    await expect(handleInboxReviewSourceTransitioned(deps, event)).rejects.toThrow(
      'envelope attribution',
    )
    expect(repo.items[0]!.snippet).toBe('legacy provider text')
    expect(receipts).toEqual([])
  })
})

describe('handleInboxReviewUpdated (BQC-3.4 — BQC-3.1 orphan resolved)', () => {
  it('delegates a Material Review Revision advance to the atomic command', async () => {
    const { deps } = makeDeps({
      sourceMeta: { ...SOURCE_META, materialReviewRevision: 2 },
    })
    const apply = vi.spyOn(deps.commandStore, 'applyReviewProjectionOnce')
    const event = makeEvent('review.updated', {
      reviewId: 'rev-1',
      organizationId: 'org-1',
      propertyId: 'prop-1',
      sourceRevision: 2,
    })

    await handleInboxReviewUpdated(deps, event)

    expect(deps.handlingCycleStore.startNext).not.toHaveBeenCalled()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'evt-1',
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
    )
  })

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

  it('missing item: bootstraps the stable item and records the update receipt', async () => {
    const { deps, repo, receipts, events } = makeDeps({ item: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items).toHaveLength(1)
    expect(repo.items[0]).toMatchObject({ sourceType: 'review', sourceId: REV })
    expect(events.capturedByTag('inbox.inbox_item.created')).toHaveLength(1)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-review-updated', status: 'applied' },
    ])
  })

  it('missing Review authority: records an obsolete receipt', async () => {
    const { deps, repo, receipts } = makeDeps({ sourceMeta: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: 'rev-1',
        organizationId: 'org-1',
        propertyId: 'prop-1',
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(repo.items[0]!.sourceDate).toEqual(new Date('2026-06-01'))
    expect(receipts).toEqual([
      {
        eventId: 'evt-1',
        consumerName: 'inbox.on-review-updated',
        status: 'obsolete',
      },
    ])
  })
})

describe('handleInboxReplyPublished (compatibility receipt only)', () => {
  it('does not let an internal workflow fact close the Inbox item', async () => {
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
    expect(repo.items[0]!.status).toBe('open')
    expect(repo.items[0]!.closedAt).toBeNull()
    expect(repo.items[0]!.firstReplyPublishedAt).toBeNull()
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-published', status: 'applied' },
    ])
  })

  it('does not backfill a milestone without current provider observation', async () => {
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
    expect(repo.items[0]!.firstReplyPublishedAt).toBeNull()
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

describe('handleInboxReplyObserved (provider-observation authority)', () => {
  const observationPayload = (overrides: Record<string, unknown> = {}) => ({
    reviewId: 'rev-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    observationRevision: 1,
    sourceEpoch: 0,
    materialReviewRevision: 1,
    change: 'added',
    resolution: 'confirmed_on_google',
    provenance: 'repkey_confirmed',
    matchedReplyId: 'reply-1',
    matchedPublicationCycle: 1,
    occurredAt: NOW.toISOString(),
    ...overrides,
  })

  it('closes and stamps once from an exact observed confirmation', async () => {
    const { deps, repo, events, receipts } = makeDeps({})

    const result = await handleInboxReplyObserved(
      deps,
      makeEvent('review.reply.observed', observationPayload()),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(repo.items[0]).toMatchObject({
      status: 'closed',
      closedAt: NOW,
      firstReplyPublishedAt: NOW,
    })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('closes and receipts an unchanged external-live head for a newer attempt', async () => {
    const { deps, repo, receipts } = makeDeps({})

    await handleInboxReplyObserved(
      deps,
      makeEvent(
        'review.reply.observed',
        observationPayload({
          change: 'unchanged',
          resolution: 'external_current_live',
          provenance: 'external_or_unknown',
          matchedReplyId: null,
          matchedPublicationCycle: null,
        }),
      ),
    )

    expect(repo.items[0]!.status).toBe('closed')
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('records an obsolete observation even when no Inbox item exists', async () => {
    const { deps, repo, receipts, replyObservationAuthority } = makeDeps({
      item: null,
      observationCurrent: false,
    })

    const result = await handleInboxReplyObserved(
      deps,
      makeEvent('review.reply.observed', observationPayload()),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    expect(repo.items).toEqual([])
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-observed', status: 'obsolete' },
    ])
  })

  it('refuses a genuinely stale material projection without a receipt', async () => {
    const { deps, repo, receipts } = makeDeps({})

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent(
          'review.reply.observed',
          observationPayload({ materialReviewRevision: 2 }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      message: 'Current reply observation is waiting for the Inbox material revision',
    })
    expect(repo.items[0]!.status).toBe('open')
    expect(receipts).toEqual([])
  })
  it('applies an epoch carry without reopening a closed item', async () => {
    const closedAt = new Date('2026-06-12T12:00:00Z')
    const { deps, repo, events, receipts } = makeDeps({
      item: makeItem({ status: 'closed', closedAt }),
      sourceEpochCarryFromMaterialReviewRevision: 1,
    })

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent(
          'review.reply.observed',
          observationPayload({
            sourceEpoch: 1,
            materialReviewRevision: 2,
            resolution: 'external_current_live',
            provenance: 'external_or_unknown',
            matchedReplyId: null,
            matchedPublicationCycle: null,
          }),
        ),
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect(repo.items[0]).toMatchObject({ status: 'closed', closedAt })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('receipts an observation as obsolete when the Inbox Handling Cycle is newer', async () => {
    const { deps, repo, receipts } = makeDeps({
      handlingCycleMaterialReviewRevision: 2,
    })

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent('review.reply.observed', observationPayload()),
      ),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(repo.items[0]!.status).toBe('open')
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-observed', status: 'obsolete' },
    ])
  })

  it('reopens a closed item after an observed provider deletion', async () => {
    const first = new Date('2026-06-12T12:00:00Z')
    const { deps, repo, events } = makeDeps({
      item: makeItem({
        status: 'closed',
        closedAt: first,
        firstReplyPublishedAt: first,
      }),
    })

    await handleInboxReplyObserved(
      deps,
      makeEvent(
        'review.reply.observed',
        observationPayload({
          observationRevision: 2,
          matchedReplyId: null,
          matchedPublicationCycle: null,
          change: 'deleted',
          resolution: 'absent',
          provenance: 'none',
        }),
      ),
    )

    expect(repo.items[0]).toMatchObject({
      status: 'open',
      closedAt: null,
      firstReplyPublishedAt: first,
    })
    expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(1)
  })

  it.each([
    ['external edit', 'external_current_live'],
    ['legacy divergence', 'diverged'],
  ] as const)(
    'does not reopen closed work for a live %s observation',
    async (_name, resolution) => {
      const first = new Date('2026-06-12T12:00:00Z')
      const { deps, repo, events } = makeDeps({
        item: makeItem({
          status: 'closed',
          closedAt: first,
          firstReplyPublishedAt: first,
        }),
      })

      await handleInboxReplyObserved(
        deps,
        makeEvent(
          'review.reply.observed',
          observationPayload({
            observationRevision: 2,
            change: 'edited',
            resolution,
            provenance: 'external_or_unknown',
            matchedReplyId: null,
            matchedPublicationCycle: null,
          }),
        ),
      )

      expect(repo.items[0]).toMatchObject({
        status: 'closed',
        closedAt: first,
        firstReplyPublishedAt: first,
      })
      expect(events.capturedByTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    },
  )

  it('retries a current observation that arrives before its Inbox item', async () => {
    const { deps, repo, receipts, replyObservationAuthority, materializeHandlingCycle } =
      makeDeps({ item: null })
    const event = makeEvent('review.reply.observed', observationPayload())

    await expect(handleInboxReplyObserved(deps, event)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    expect(receipts).toEqual([])

    const item = makeItem()
    repo.items.push(item)
    materializeHandlingCycle(item)
    await expect(handleInboxReplyObserved(deps, event)).resolves.toEqual({
      status: 'applied',
    })
    expect(repo.items[0]).toMatchObject({
      status: 'closed',
      firstReplyPublishedAt: NOW,
    })
    expect(receipts).toEqual([
      { eventId: 'evt-1', consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('retries without a receipt while the Inbox Handling Cycle is missing', async () => {
    const { deps, receipts, replyObservationAuthority } = makeDeps({
      handlingCycleMissing: true,
    })

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent('review.reply.observed', observationPayload()),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    expect(receipts).toEqual([])
  })
})
