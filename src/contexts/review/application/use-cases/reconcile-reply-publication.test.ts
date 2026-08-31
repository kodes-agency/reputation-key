// BQC-3.3 — reconcileReplyPublication use case tests.
//
// Manual/operator recovery for an ambiguous publish outcome: make one targeted
// provider read; if Google shows the reply, heal the
// divergence atomically (markPublished + durable fact); otherwise the reply
// records absent/divergent truth without publishing. Never calls the publish endpoint —
// never duplicates a Google-visible reply.

import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, vi } from 'vitest'
import { reconcileReplyPublication } from './reconcile-reply-publication'
import type { ReconcileReplyPublicationDeps } from './reconcile-reply-publication'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { RecordGoogleReplyObservation } from '../ports/google-reply-observation-store.port'
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
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationCycle: 1,
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
    externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: CONN_ID,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great!',
    translatedText: null,
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
    sourceEpoch: 0,
    sourceRevision: 1,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeGoogleReview(overrides: Partial<GoogleReview> = {}): GoogleReview {
  return {
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
    replyText: null,
    replyUpdatedAt: null,
    ...overrides,
  }
}

type FoundProviderReview = Readonly<{
  status: 'found'
  review: GoogleReview
}>

function deferredProviderRead() {
  let resolve!: (value: FoundProviderReview) => void
  const promise = new Promise<FoundProviderReview>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function makeDeps(overrides: {
  reply?: Reply | null
  review?: Review | null
  googleReview?: GoogleReview | null
  googleError?: Error
}) {
  const replyRepo = {
    findById: vi.fn(async () => overrides.reply ?? null),
  } as unknown as ReplyRepository
  const reviewRepo = {
    findById: vi.fn(async () => overrides.review ?? null),
  } as unknown as ReviewRepository
  const googleReviewApi = {
    getReview: overrides.googleError
      ? vi.fn(async () => {
          throw overrides.googleError
        })
      : vi.fn(async () =>
          overrides.googleReview
            ? { status: 'found' as const, review: overrides.googleReview }
            : { status: 'not_found' as const },
        ),
    replyToReview: vi.fn(async () => ({ providerCorrelationId: null })),
  } as unknown as GoogleReviewApiPort
  const observationStore = {
    allocateReadGeneration: vi.fn(async () => 1),
    findCurrentHead: vi.fn(async () => null),
    record: vi.fn(async (input: RecordGoogleReplyObservation) => ({
      observationRevision: 1,
      change: input.observedText === null ? ('deleted' as const) : ('added' as const),
      resolution:
        input.observedText === 'Thank you!'
          ? ('confirmed_on_google' as const)
          : input.observedText === null
            ? ('absent' as const)
            : ('external_current_live' as const),
      matchedReplyId: input.observedText === 'Thank you!' ? REPLY_ID : null,
      matchedPublicationCycle: input.observedText === 'Thank you!' ? 1 : null,
      duplicate: false,
    })),
  }

  const deps: ReconcileReplyPublicationDeps = {
    replyRepo,
    reviewRepo,
    googleReviewApi,
    observationStore,
    clock: () => NOW,
  }
  return { deps, googleReviewApi, observationStore }
}

describe('reconcileReplyPublication', () => {
  it('provider shows the exact reply → delegates to the observation authority', async () => {
    const { deps, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: 'Thank you!' }),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('confirmed_on_google')
    expect(observationStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: REVIEW_ID,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        observedText: 'Thank you!',
        source: 'targeted_reconciliation',
      }),
    )
  })

  it('provider has the review but no reply → records an absent observation', async () => {
    const { deps, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: null }),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('absent')
    expect(observationStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ observedText: null }),
    )
  })

  it('binds the targeted observation identity to the current source fences', async () => {
    const first = makeDeps({
      reply: makeReply(),
      review: makeReview({ sourceEpoch: 2, sourceRevision: 4 }),
      googleReview: makeGoogleReview({ replyText: 'Thank you!' }),
    })
    const second = makeDeps({
      reply: makeReply(),
      review: makeReview({ sourceEpoch: 3, sourceRevision: 5 }),
      googleReview: makeGoogleReview({ replyText: 'Thank you!' }),
    })

    await reconcileReplyPublication(first.deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
    await reconcileReplyPublication(second.deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    const firstKey = first.observationStore.record.mock.calls[0]?.[0].observationKey
    const secondKey = second.observationStore.record.mock.calls[0]?.[0].observationKey
    expect(firstKey).toMatch(/^[0-9a-f]{64}$/u)
    expect(secondKey).toMatch(/^[0-9a-f]{64}$/u)
    expect(firstKey).not.toBe(secondKey)
  })

  it("does not confuse a live reply whose text is 'absent' with no reply", async () => {
    const live = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: 'absent', replyUpdatedAt: null }),
    })
    const absent = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: null, replyUpdatedAt: null }),
    })

    await reconcileReplyPublication(live.deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
    await reconcileReplyPublication(absent.deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(live.observationStore.record.mock.calls[0]?.[0].observationKey).not.toBe(
      absent.observationStore.record.mock.calls[0]?.[0].observationKey,
    )
  })

  it('provider no longer returns the review → does not invent reply deletion', async () => {
    const { deps, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: null,
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('provider_review_missing')
    expect(observationStore.record).not.toHaveBeenCalled()
    expect(observationStore.allocateReadGeneration).not.toHaveBeenCalled()
  })

  it('never calls the publish endpoint (no duplicate Google-visible reply)', async () => {
    const { deps, googleReviewApi } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: 'Thank you!' }),
    })

    await reconcileReplyPublication(deps)({ replyId: REPLY_ID, organizationId: ORG_ID })

    expect(googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('re-reads only the targeted review through getReview', async () => {
    const { deps, googleReviewApi } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: null,
    })

    await reconcileReplyPublication(deps)({ replyId: REPLY_ID, organizationId: ORG_ID })

    expect(googleReviewApi.getReview).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      connectionId: CONN_ID,
      sourceEpoch: 0,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    })
  })

  it('orders read generations by provider response acquisition, not request start', async () => {
    const { deps, googleReviewApi, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview(),
    })
    const firstRequest = deferredProviderRead()
    const secondRequest = deferredProviderRead()
    let providerCalls = 0
    vi.mocked(googleReviewApi.getReview).mockImplementation(() =>
      providerCalls++ === 0 ? firstRequest.promise : secondRequest.promise,
    )
    let generation = 0
    observationStore.allocateReadGeneration.mockImplementation(async () => ++generation)

    const firstRun = reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
    const secondRun = reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
    await vi.waitFor(() => expect(googleReviewApi.getReview).toHaveBeenCalledTimes(2))

    secondRequest.resolve({
      status: 'found',
      review: makeGoogleReview({ replyText: 'response acquired first' }),
    })
    await vi.waitFor(() => expect(observationStore.record).toHaveBeenCalledTimes(1))
    firstRequest.resolve({
      status: 'found',
      review: makeGoogleReview({ replyText: 'response acquired second' }),
    })
    await Promise.all([firstRun, secondRun])

    const recorded = observationStore.record.mock.calls.map(([input]) => input)
    expect(
      recorded.find((input) => input.observedText === 'response acquired first')
        ?.readGeneration,
    ).toBe(1)
    expect(
      recorded.find((input) => input.observedText === 'response acquired second')
        ?.readGeneration,
    ).toBe(2)
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
    const { deps, observationStore } = makeDeps({
      reply: makeReply({ status: 'published' }),
      review: makeReview(),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toMatchObject({ code: 'invalid_transition' })
    expect(observationStore.record).not.toHaveBeenCalled()
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

  it('review has no Google connection → provider_review_missing (cannot re-read)', async () => {
    const { deps, googleReviewApi } = makeDeps({
      reply: makeReply(),
      review: makeReview({ googleConnectionId: null }),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.outcome).toBe('provider_review_missing')
    expect(googleReviewApi.getReview).not.toHaveBeenCalled()
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
