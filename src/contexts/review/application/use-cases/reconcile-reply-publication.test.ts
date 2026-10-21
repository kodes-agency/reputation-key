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
import type {
  GoogleReviewApiPort,
  GoogleReviewRead,
} from '../ports/google-review-api.port'
import type {
  GoogleReplyObservationResult,
  RecordGoogleReplyObservation,
} from '../ports/google-reply-observation-store.port'
import type { Reply, Review } from '../../domain/types'
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
    templateId: overrides.templateId ?? null,
    templateVersion: overrides.templateVersion ?? null,
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
    googleReviewUrl: null,
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

function makeGoogleReview(overrides: Partial<GoogleReviewRead> = {}): GoogleReviewRead {
  return {
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
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
  review: GoogleReviewRead
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
  googleReview?: GoogleReviewRead | null
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
    record: vi.fn(
      async (
        input: RecordGoogleReplyObservation,
      ): Promise<GoogleReplyObservationResult> => ({
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
      }),
    ),
  }

  const logger = { info: vi.fn() }

  const deps: ReconcileReplyPublicationDeps = {
    replyRepo,
    reviewRepo,
    googleReviewApi,
    observationStore,
    clock: () => NOW,
    logger,
  }
  return { deps, googleReviewApi, observationStore, logger }
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

  // D6: Google returned a reply RepKey cannot read (translation-only envelope).
  // Recording it as absent would be a lie about provider truth; recording
  // nothing keeps the attempt exactly as uncertain as it was.
  it('provider shows a reply RepKey cannot read → records nothing and reports unreadable', async () => {
    const { deps, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: null, replyUnreadable: true }),
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual({ outcome: 'unreadable', reason: 'reply_unreadable' })
    }
    expect(observationStore.allocateReadGeneration).not.toHaveBeenCalled()
    expect(observationStore.record).not.toHaveBeenCalled()
  })

  // D6: the observation authority records a whitespace-only difference from the
  // in-flight attempt as `diverged` (it neither confirms nor supersedes), and the
  // targeted read reports that as a check that could not decide anything.
  it('observation authority saw only a whitespace difference → reports unreadable', async () => {
    const { deps, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: 'Thank  you!\n\n' }),
    })
    observationStore.record.mockResolvedValueOnce({
      observationRevision: 2,
      change: 'added',
      resolution: 'diverged',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      duplicate: false,
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual({
        outcome: 'unreadable',
        reason: 'whitespace_only_difference',
      })
    }
  })

  // An edit-and-republish whose echo has not arrived: Google still shows the
  // reply it was written over. The authority recorded nothing and decided
  // nothing, and the read says so in its own word, not as another author's
  // reply (which is what a plain `unchanged` live read is reported as).
  it('observation authority saw the earlier publication still live → reports it, not a different reply', async () => {
    const { deps, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({ replyText: 'The reply before the edit' }),
    })
    observationStore.record.mockResolvedValueOnce({
      observationRevision: 1,
      change: 'unchanged',
      resolution: 'earlier_publication_live',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      duplicate: true,
    })

    const result = await reconcileReplyPublication(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toEqual({ outcome: 'earlier_publication_live' })
    }
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

// Google moderates owner replies. The sweep's read is one of the two reads
// RepKey makes of its own attempt, so it writes the one content-free line the
// behaviour decision will be designed from, and decides nothing differently.
describe('reconcileReplyPublication reading Google moderation', () => {
  const run = (deps: ReconcileReplyPublicationDeps) =>
    reconcileReplyPublication(deps)({ replyId: REPLY_ID, organizationId: ORG_ID })

  it('writes one read-back line with the state and what Google sent', async () => {
    const { deps, logger } = makeDeps({
      reply: makeReply({ publicationCycle: 2, publicationAttempts: 3 }),
      review: makeReview(),
      googleReview: makeGoogleReview({
        replyText: 'Thank you!',
        replyUpdatedAt: NOW,
        replyModeration: {
          state: 'pending',
          policyViolation: null,
          commentPresent: true,
          commentEmpty: false,
          updateTimePresent: true,
          updateTimeEmpty: false,
        },
      }),
    })

    await run(deps)

    expect(logger.info).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      {
        event: 'reply_publication_readback',
        source: 'reconcile_sweep',
        publicationCycle: 2,
        attemptNumber: 3,
        moderationState: 'pending',
        commentPresent: true,
        commentEmpty: false,
        updateTimePresent: true,
        updateTimeEmpty: false,
        textMatchedAttempt: true,
      },
      expect.any(String),
    )
  })

  it('carries the policy code of a rejected reply, never its text', async () => {
    const { deps, logger } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({
        replyText: 'Something else entirely',
        replyModeration: {
          state: 'rejected',
          policyViolation: 'SPAM',
          commentPresent: true,
          commentEmpty: false,
          updateTimePresent: false,
          updateTimeEmpty: false,
        },
      }),
    })

    await run(deps)

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        moderationState: 'rejected',
        policyViolation: 'SPAM',
        textMatchedAttempt: false,
      }),
      expect.any(String),
    )
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('entirely')
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('Thank you')
  })

  it('writes the line for a reply it cannot read too, before it records nothing', async () => {
    const { deps, logger, observationStore } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: makeGoogleReview({
        replyText: null,
        replyUnreadable: true,
        replyModeration: {
          state: 'pending',
          policyViolation: null,
          commentPresent: true,
          commentEmpty: false,
          updateTimePresent: true,
          updateTimeEmpty: false,
        },
      }),
    })

    await run(deps)

    expect(observationStore.record).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ moderationState: 'pending', textMatchedAttempt: false }),
      expect.any(String),
    )
  })

  it('writes no line when Google no longer returns the review', async () => {
    const { deps, logger } = makeDeps({
      reply: makeReply(),
      review: makeReview(),
      googleReview: null,
    })

    await run(deps)

    expect(logger.info).not.toHaveBeenCalled()
  })

  it.each([
    ['pending', 'Thank you!'],
    ['pending', 'A different reply'],
    ['rejected', 'Thank you!'],
    ['unspecified', 'Thank you!'],
    ['approved', 'Thank you!'],
    ['pending', null],
  ] as const)(
    'decides a %s read of %s exactly as the same read without the field',
    async (state, replyText) => {
      const without = makeDeps({
        reply: makeReply(),
        review: makeReview(),
        googleReview: makeGoogleReview({ replyText, replyUpdatedAt: NOW }),
      })
      const withState = makeDeps({
        reply: makeReply(),
        review: makeReview(),
        googleReview: makeGoogleReview({
          replyText,
          replyUpdatedAt: NOW,
          replyModeration: {
            state,
            policyViolation: state === 'rejected' ? 'SPAM' : null,
            commentPresent: replyText !== null,
            commentEmpty: false,
            updateTimePresent: true,
            updateTimeEmpty: false,
          },
        }),
      })

      const expected = await run(without.deps)
      const actual = await run(withState.deps)

      expect(withState.observationStore.record.mock.calls).toEqual(
        without.observationStore.record.mock.calls,
      )
      expect(actual.isOk() && actual.value).toEqual(expected.isOk() && expected.value)
    },
  )
})
