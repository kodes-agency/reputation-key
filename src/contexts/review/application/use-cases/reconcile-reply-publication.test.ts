// BQC-3.3 — reconcileReplyPublication use case tests.
//
// Manual/operator recovery for an ambiguous publish outcome: re-read the
// provider state via the sync read path; if Google shows the reply, heal the
// divergence atomically (markPublished + durable fact); otherwise the reply
// stays publish_failed ('still_failed'). Never calls the publish endpoint —
// never duplicates a Google-visible reply.

import { describe, it, expect, vi } from 'vitest'
import { reconcileReplyPublication } from './reconcile-reply-publication'
import type { ReconcileReplyPublicationDeps } from './reconcile-reply-publication'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { Reply, Review, GoogleReview } from '../../domain/types'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  userId,
  googleConnectionId,
} from '#/shared/domain/ids'

const ORG_ID = organizationId('org-1')
const PROP_ID = propertyId('prop-1')
const REVIEW_ID = reviewId('rev-1')
const REPLY_ID = replyId('reply-1')
const CONN_ID = googleConnectionId('conn-1')
const USER_ID = userId('user-1')
const NOW = new Date('2026-07-17T00:00:00Z')

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: REPLY_ID,
    reviewId: REVIEW_ID,
    organizationId: ORG_ID,
    text: 'Thank you!',
    status: 'publish_failed',
    source: 'internal',
    createdBy: USER_ID,
    approvedBy: USER_ID,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationAttempts: 3,
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'accounts/111/locations/222',
    googleConnectionId: CONN_ID,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great!',
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: NOW,
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: null,
    contentHash: null,
    sourceSeenGeneration: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeGoogleReview(overrides: Partial<GoogleReview> = {}): GoogleReview {
  return {
    reviewName: 'accounts/111/locations/222/reviews/ext-1',
    externalId: 'ext-1',
    externalLocationId: 'accounts/111/locations/222',
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great!',
    languageCode: 'en',
    reviewedAt: NOW,
    replyText: null,
    replyUpdatedAt: null,
    ...overrides,
  }
}

function makeDeps(overrides: {
  reply?: Reply | null
  review?: Review | null
  googleReviews?: ReadonlyArray<GoogleReview>
  googleError?: Error
}) {
  const emitted: Array<Record<string, unknown>> = []
  const events = {
    emit: vi.fn(async (event: Record<string, unknown>) => {
      emitted.push(event)
    }),
    on: vi.fn(),
  } as unknown as EventBus

  const replyRepo = {
    findById: vi.fn(async () => overrides.reply ?? null),
  } as unknown as ReplyRepository
  const reviewRepo = {
    findById: vi.fn(async () => overrides.review ?? null),
  } as unknown as ReviewRepository
  const googleReviewApi = {
    fetchReviews: overrides.googleError
      ? vi.fn(async () => {
          throw overrides.googleError
        })
      : vi.fn(async () => overrides.googleReviews ?? []),
    replyToReview: vi.fn(async () => {}),
  } as unknown as GoogleReviewApiPort

  // In-process command-store fake (application zone must not import infra):
  // applies the guarded transition, then emits post-commit.
  const commandStore: ReplyCommandStore = {
    submitReply: vi.fn(),
    rejectReply: vi.fn(),
    markPublished: vi.fn(async (reply: Reply, updates, event) => {
      const saved: Reply = { ...reply, ...updates, updatedAt: NOW }
      await events.emit(event)
      return saved
    }),
    markPublicationAuthorized: vi.fn(),
    markPublicationSending: vi.fn(),
    markPublicationTerminal: vi.fn(),
    markPublicationAmbiguous: vi.fn(),
    markPublicationRetryQueued: vi.fn(),
    editPublishedReply: vi.fn(),
    cancelPublications: vi.fn(),
    mirrorSyncedReply: vi.fn(),
    purgeExpiredReview: vi.fn(),
  }

  const deps: ReconcileReplyPublicationDeps = {
    replyRepo,
    reviewRepo,
    googleReviewApi,
    commandStore,
    clock: () => NOW,
  }
  return { deps, emitted, googleReviewApi, commandStore }
}

describe('reconcileReplyPublication', () => {
  it('provider shows the reply → marks published atomically and emits the durable fact', async () => {
    const { deps, emitted, commandStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReviews: [makeGoogleReview({ replyText: 'Thank you!' })],
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('published')
    expect(commandStore.markPublished).toHaveBeenCalledTimes(1)
    const event = emitted[0]
    expect(event).toMatchObject({
      _tag: 'review.reply.published',
      replyId: REPLY_ID,
      reviewId: REVIEW_ID,
      propertyId: PROP_ID,
      organizationId: ORG_ID,
      userId: null,
      authorId: USER_ID,
    })
  })

  it('provider has the review but no reply → still_failed, no state change, no event', async () => {
    const { deps, emitted, commandStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReviews: [makeGoogleReview({ replyText: null })],
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('still_failed')
    expect(commandStore.markPublished).not.toHaveBeenCalled()
    expect(emitted).toHaveLength(0)
  })

  it('provider no longer returns the review → still_failed', async () => {
    const { deps, commandStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReviews: [],
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('still_failed')
    expect(commandStore.markPublished).not.toHaveBeenCalled()
  })

  it('never calls the publish endpoint (no duplicate Google-visible reply)', async () => {
    const { deps, googleReviewApi } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReviews: [makeGoogleReview({ replyText: 'Thank you!' })],
    })

    await reconcileReplyPublication(deps)({ replyId: REPLY_ID, organizationId: ORG_ID })

    expect(googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('re-reads provider state through the sync read path (fetchReviews for the review location)', async () => {
    const { deps, googleReviewApi } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReviews: [],
    })

    await reconcileReplyPublication(deps)({ replyId: REPLY_ID, organizationId: ORG_ID })

    expect(googleReviewApi.fetchReviews).toHaveBeenCalledWith(
      ORG_ID,
      CONN_ID,
      'accounts/111/locations/222',
    )
  })

  it('reply not found → err reply_not_found', async () => {
    const { deps } = makeDeps({ reply: null, review: makeReview() })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'reply_not_found' })
  })

  it('reply not in publish_failed → err invalid_transition (nothing to reconcile)', async () => {
    const { deps, commandStore } = makeDeps({
      reply: makeReply({ status: 'published' }),
      review: makeReview(),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'invalid_transition' })
    expect(commandStore.markPublished).not.toHaveBeenCalled()
  })

  it('review missing → err review_not_found', async () => {
    const { deps } = makeDeps({ reply: makeReply(), review: null })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'review_not_found' })
  })

  it('review has no Google connection → still_failed (cannot re-read provider)', async () => {
    const { deps, googleReviewApi } = makeDeps({
      reply: makeReply(),
      review: makeReview({ googleConnectionId: null }),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('still_failed')
    expect(googleReviewApi.fetchReviews).not.toHaveBeenCalled()
  })

  it('provider read failure → err sync_failed', async () => {
    const { deps } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleError: new Error('API down'),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'sync_failed' })
  })
})
