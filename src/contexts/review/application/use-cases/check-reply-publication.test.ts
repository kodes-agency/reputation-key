// D5 — "Check Google again" returns what RepKey found instead of throwing.
//
// Order under test: dispatch evidence first (positive non-dispatch settles the
// attempt with no Google read), then one targeted read, then a re-read of the
// reply. No path may write to Google, authorize a cycle or enqueue a job.

import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi } from 'vitest'
import { err, ok } from '#/shared/domain'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  replyId,
  reviewId,
  userId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { Reply, Review } from '../../domain/types'
import { reviewError } from '../../domain/errors'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { ReplyDispatchEvidence } from '../ports/reply-publication-dispatch-evidence.port'
import {
  reconcileReplyPublication,
  type ReconcilePublicationOutcome,
  type ReconcileReplyPublication,
} from './reconcile-reply-publication'
import {
  checkReplyPublication,
  type CheckReplyPublicationDeps,
} from './check-reply-publication'

const ORG_ID = organizationId('org-check-publication')
const PROP_ID = propertyId('52000000-0000-4000-8000-000000000001')
const REVIEW_ID = reviewId('52000000-0000-4000-8000-000000000010')
const REPLY_ID = replyId('52000000-0000-4000-8000-000000000020')
const USER_ID = userId('user-check-publication')
const NOW = new Date('2026-09-14T12:00:00.000Z')
const ATTEMPT_STARTED_AT = new Date('2026-09-14T10:00:00.000Z')
const NEXT_CHECK = new Date('2026-09-14T14:00:00.000Z')

const MANAGER = {
  role: 'PropertyManager' as const,
  userId: USER_ID,
  organizationId: ORG_ID,
}
const MEMBER = { role: 'Member' as const, userId: USER_ID, organizationId: ORG_ID }
const NOTHING_TO_CHECK = 'This reply has nothing to check on Google.'
const COULD_NOT_REACH =
  "RepKey couldn't reach Google to check this reply. Try again in a minute."

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: REPLY_ID,
    reviewId: REVIEW_ID,
    organizationId: ORG_ID,
    text: 'Thank you!',
    source: 'internal',
    status: 'publish_failed',
    createdBy: USER_ID,
    approvedBy: USER_ID,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 3,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'ambiguous',
    publicationCycle: 1,
    publicationAttempts: 2,
    publicationLastErrorClass: 'ambiguous',
    reconcileDueAt: NEXT_CHECK,
    createdAt: NOW,
    updatedAt: NOW,
    templateId: null,
    templateVersion: null,
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
    googleConnectionId: googleConnectionId('52000000-0000-4000-8000-000000000030'),
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

const settledNeverSent = (from: Reply): Reply => ({
  ...from,
  status: 'publish_failed',
  publicationState: 'terminal',
  publicationLastErrorClass: 'retryable',
  reconcileDueAt: null,
})

type Harness = Readonly<{
  deps: CheckReplyPublicationDeps
  findById: ReturnType<typeof vi.fn>
  findDispatchEvidence: ReturnType<typeof vi.fn>
  findCurrentPublicationAttemptStartedAt: ReturnType<typeof vi.fn>
  settleNeverDispatchedAttempt: ReturnType<typeof vi.fn>
  reconcile: ReturnType<typeof vi.fn>
  logger: Readonly<{ info: ReturnType<typeof vi.fn> }>
  /** Publication-authorizing store writes, present so any call is visible. The
   * check's deps carry no queue and no Google client at all; the last test
   * wires the real targeted read to prove the publish endpoint stays untouched. */
  forbidden: Readonly<Record<string, ReturnType<typeof vi.fn>>>
}>

function makeHarness(
  input: Readonly<{
    reply: Reply | null
    afterRead?: Reply | null
    evidence?: ReplyDispatchEvidence
    reconciled?: Awaited<ReturnType<ReconcileReplyPublication>>
    accessible?: ReadonlyArray<PropertyId> | null
    settled?: Reply | null
  }>,
): Harness {
  const findById = vi.fn(async () =>
    input.afterRead === undefined ? input.reply : input.afterRead,
  )
  const findCurrentPublicationAttemptStartedAt = vi.fn(async () => ATTEMPT_STARTED_AT)
  const findDispatchEvidence = vi.fn(async () => input.evidence ?? 'possibly_dispatched')
  const settleNeverDispatchedAttempt = vi.fn(async (reply: Reply) =>
    input.settled === undefined ? settledNeverSent(reply) : input.settled,
  )
  const reconcile = vi.fn(
    async () =>
      input.reconciled ?? ok<ReconcilePublicationOutcome>({ outcome: 'absent' }),
  )
  const logger = { info: vi.fn() }
  const forbidden = {
    markPublicationAuthorized: vi.fn(),
    markPublicationSending: vi.fn(),
  }
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () =>
      input.accessible === undefined ? null : input.accessible,
    getAssignedPortals: async () => [],
  }
  const deps: CheckReplyPublicationDeps = {
    replyRepo: {
      findInternalByReviewId: vi.fn(async () => input.reply),
      findById,
      findCurrentPublicationAttemptStartedAt,
    } as unknown as ReplyRepository,
    reviewRepo: {
      findById: vi.fn(async () => makeReview()),
    } as unknown as ReviewRepository,
    staffPublicApi,
    commandStore: {
      settleNeverDispatchedAttempt,
      markPublicationAuthorized: forbidden.markPublicationAuthorized,
      markPublicationSending: forbidden.markPublicationSending,
    } as unknown as ReplyCommandStore,
    dispatchEvidence: { findDispatchEvidence },
    reconcileReplyPublication: reconcile as unknown as ReconcileReplyPublication,
    clock: () => NOW,
    logger,
  }
  return {
    deps,
    logger,
    findById,
    findDispatchEvidence,
    findCurrentPublicationAttemptStartedAt,
    settleNeverDispatchedAttempt,
    reconcile,
    forbidden,
  }
}

const expectNoWriteToGoogle = (harness: Harness) => {
  for (const [name, spy] of Object.entries(harness.forbidden)) {
    expect(spy, name).not.toHaveBeenCalled()
  }
}

const check = (harness: Harness, ctx: typeof MANAGER | typeof MEMBER = MANAGER) =>
  checkReplyPublication(harness.deps)({ reviewId: REVIEW_ID }, ctx)

describe('checkReplyPublication — positive non-dispatch evidence', () => {
  it.each([
    ['a legacy ambiguous row', makeReply()],
    [
      'terminal ambiguity',
      makeReply({ publicationState: 'terminal', reconcileDueAt: null }),
    ],
    [
      'an approved attempt still marked sending',
      makeReply({
        status: 'approved',
        publicationState: 'sending',
        publicationLastErrorClass: null,
      }),
    ],
  ])('settles %s as never sent without reading Google', async (_name, reply) => {
    const harness = makeHarness({ reply, evidence: 'never_dispatched' })

    const result = await check(harness)

    expect(result).toEqual({
      reply: settledNeverSent(reply),
      outcome: 'never_sent',
      checkedAt: NOW,
      nextAutomaticCheckAt: null,
    })
    expect(harness.findCurrentPublicationAttemptStartedAt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      reviewId: REVIEW_ID,
      replyId: REPLY_ID,
      publicationCycle: 1,
      attemptNumber: 2,
    })
    expect(harness.findDispatchEvidence).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      replyId: REPLY_ID,
      publicationCycle: 1,
      attemptNumber: 2,
      attemptStartedAt: ATTEMPT_STARTED_AT,
      now: NOW,
    })
    expect(harness.settleNeverDispatchedAttempt).toHaveBeenCalledWith(
      reply,
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        replyId: REPLY_ID,
        propertyId: PROP_ID,
        organizationId: ORG_ID,
      }),
      NOW,
    )
    expect(harness.reconcile).not.toHaveBeenCalled()
    expectNoWriteToGoogle(harness)
  })

  it.each<ReplyDispatchEvidence>(['possibly_dispatched', 'too_recent'])(
    'reads Google and settles nothing when the evidence is %s',
    async (evidence) => {
      const harness = makeHarness({ reply: makeReply(), evidence })

      const result = await check(harness)

      expect(result.outcome).toBe('not_on_google')
      expect(harness.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
      expect(harness.reconcile).toHaveBeenCalledWith({
        replyId: REPLY_ID,
        organizationId: ORG_ID,
      })
      expectNoWriteToGoogle(harness)
    },
  )

  it('reads Google when the attempt has no dated attempt row to judge', async () => {
    const harness = makeHarness({ reply: makeReply(), evidence: 'never_dispatched' })
    harness.findCurrentPublicationAttemptStartedAt.mockResolvedValueOnce(null)

    const result = await check(harness)

    expect(result.outcome).toBe('not_on_google')
    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
    expect(harness.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
  })

  it('reads Google when the settle write loses its race', async () => {
    const harness = makeHarness({
      reply: makeReply(),
      evidence: 'never_dispatched',
      settled: null,
    })

    const result = await check(harness)

    expect(result.outcome).toBe('not_on_google')
    expect(harness.reconcile).toHaveBeenCalledOnce()
  })

  it('never asks for dispatch evidence about a write Google acknowledged', async () => {
    const harness = makeHarness({
      reply: makeReply({
        status: 'approved',
        publicationState: 'pending_observation',
        publicationLastErrorClass: null,
      }),
      evidence: 'never_dispatched',
    })

    await check(harness)

    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
    expect(harness.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
    expect(harness.reconcile).toHaveBeenCalledOnce()
  })
})

describe('checkReplyPublication — what the Google read found', () => {
  const published = makeReply({
    status: 'published',
    publicationState: 'published',
    publishedAt: NOW,
    reconcileDueAt: null,
  })

  it.each<[ReconcilePublicationOutcome['outcome'], Reply, string]>([
    ['confirmed_on_google', published, 'live_on_google'],
    ['absent', makeReply(), 'not_on_google'],
    ['external_current_live', makeReply(), 'different_reply_on_google'],
    ['diverged', makeReply(), 'different_reply_on_google'],
    ['provider_review_missing', makeReply(), 'review_missing_on_google'],
    ['unreadable', makeReply(), 'unreadable_on_google'],
  ])('maps %s to its check outcome', async (reconciled, afterRead, outcome) => {
    const harness = makeHarness({
      reply: makeReply(),
      afterRead,
      reconciled: ok({ outcome: reconciled }),
    })

    const result = await check(harness)

    expect(result).toEqual({
      reply: afterRead,
      outcome,
      checkedAt: NOW,
      nextAutomaticCheckAt: afterRead.reconcileDueAt,
    })
    expect(harness.findById).toHaveBeenCalledWith(REPLY_ID, ORG_ID)
    expectNoWriteToGoogle(harness)
  })

  // D6: why Google's reply could not be matched is logged, content-free, on the
  // manager's check as it is on the sweep and the job.
  it('logs the content-free reason for an unreadable read', async () => {
    const harness = makeHarness({
      reply: makeReply(),
      reconciled: ok({ outcome: 'unreadable', reason: 'whitespace_only_difference' }),
    })

    await expect(check(harness)).resolves.toMatchObject({
      outcome: 'unreadable_on_google',
    })
    expect(harness.logger.info).toHaveBeenCalledWith(
      { reason: 'whitespace_only_difference' },
      expect.any(String),
    )
  })

  it('reports the reply as live when an observation published it during the read', async () => {
    const harness = makeHarness({ reply: makeReply(), afterRead: published })

    await expect(check(harness)).resolves.toMatchObject({
      outcome: 'live_on_google',
      reply: published,
      nextAutomaticCheckAt: null,
    })
  })

  it('reports cancellation that landed during the read', async () => {
    const cancelled = makeReply({
      status: 'draft',
      publicationState: 'cancelled',
      reconcileDueAt: null,
    })
    const harness = makeHarness({ reply: makeReply(), afterRead: cancelled })

    await expect(check(harness)).resolves.toMatchObject({
      outcome: 'cancelled',
      reply: cancelled,
    })
  })

  it('returns an already published reply as live without any evidence or read', async () => {
    const harness = makeHarness({ reply: published })

    await expect(check(harness)).resolves.toEqual({
      reply: published,
      outcome: 'live_on_google',
      checkedAt: NOW,
      nextAutomaticCheckAt: null,
    })
    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
    expect(harness.reconcile).not.toHaveBeenCalled()
  })
})

describe('checkReplyPublication — refusals', () => {
  it.each([
    ['a draft', makeReply({ status: 'draft', publicationState: null })],
    [
      'an attempt that never reached Google',
      makeReply({ publicationState: 'terminal', publicationLastErrorClass: 'retryable' }),
    ],
    [
      'an authorized cycle waiting for its job',
      makeReply({ status: 'approved', publicationState: 'authorized' }),
    ],
    [
      'a cancelled publication',
      makeReply({ status: 'draft', publicationState: 'cancelled' }),
    ],
  ])('refuses %s with nothing to check', async (_name, reply) => {
    const harness = makeHarness({ reply, evidence: 'never_dispatched' })

    await expect(check(harness)).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_transition',
      message: NOTHING_TO_CHECK,
    })
    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
    expect(harness.reconcile).not.toHaveBeenCalled()
  })

  it('says RepKey could not reach Google when the read fails', async () => {
    const harness = makeHarness({
      reply: makeReply(),
      reconciled: err(
        reviewError('sync_failed', 'Failed to re-read provider reply state'),
      ),
    })

    await expect(check(harness)).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'sync_failed',
      message: COULD_NOT_REACH,
    })
    expectNoWriteToGoogle(harness)
  })

  it('still reports a published or cancelled reply when the read fails', async () => {
    const failedRead = err(reviewError('sync_failed', 'Failed to re-read'))
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const cancelled = makeReply({ status: 'draft', publicationState: 'cancelled' })

    await expect(
      check(
        makeHarness({ reply: makeReply(), afterRead: published, reconciled: failedRead }),
      ),
    ).resolves.toMatchObject({ outcome: 'live_on_google' })
    await expect(
      check(
        makeHarness({ reply: makeReply(), afterRead: cancelled, reconciled: failedRead }),
      ),
    ).resolves.toMatchObject({ outcome: 'cancelled' })
  })

  it('says there is nothing to check when the reply left the uncertain state first', async () => {
    const harness = makeHarness({
      reply: makeReply(),
      afterRead: settledNeverSent(makeReply()),
      reconciled: err(
        reviewError(
          'invalid_transition',
          'Only provider-pending or uncertain replies need publication reconciliation',
        ),
      ),
    })

    await expect(check(harness)).rejects.toMatchObject({
      code: 'invalid_transition',
      message: NOTHING_TO_CHECK,
    })
  })

  it('refuses a member before reading the reply', async () => {
    const harness = makeHarness({ reply: makeReply() })

    await expect(check(harness, MEMBER)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(harness.deps.replyRepo.findInternalByReviewId).not.toHaveBeenCalled()
    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
  })

  it('refuses a manager without access to the property before any evidence or read', async () => {
    const harness = makeHarness({ reply: makeReply(), accessible: [] })

    await expect(check(harness)).rejects.toMatchObject({ code: 'forbidden' })
    expect(harness.findDispatchEvidence).not.toHaveBeenCalled()
    expect(harness.reconcile).not.toHaveBeenCalled()
  })

  it('refuses when the review has no reply', async () => {
    const harness = makeHarness({ reply: null })

    await expect(check(harness)).rejects.toMatchObject({ code: 'reply_not_found' })
  })
})

describe('checkReplyPublication — through the real targeted read', () => {
  it('makes exactly one Google read and never calls the publish endpoint', async () => {
    const reply = makeReply({
      status: 'approved',
      publicationState: 'sending',
      publicationLastErrorClass: null,
    })
    const harness = makeHarness({ reply, evidence: 'too_recent' })
    const googleReviewApi = {
      getReview: vi.fn(async () => ({
        status: 'found' as const,
        review: {
          reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
          externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
          replyText: null,
          replyUpdatedAt: null,
        },
      })),
      replyToReview: vi.fn(),
    } as unknown as GoogleReviewApiPort
    const deps: CheckReplyPublicationDeps = {
      ...harness.deps,
      reconcileReplyPublication: reconcileReplyPublication({
        replyRepo: harness.deps.replyRepo,
        reviewRepo: harness.deps.reviewRepo,
        googleReviewApi,
        observationStore: {
          allocateReadGeneration: vi.fn(async () => 1),
          findCurrentHead: vi.fn(async () => null),
          record: vi.fn(async () => ({
            observationRevision: 1,
            change: 'deleted' as const,
            resolution: 'absent' as const,
            matchedReplyId: null,
            matchedPublicationCycle: null,
            duplicate: false,
          })),
        },
        clock: () => NOW,
      }),
    }

    const result = await checkReplyPublication(deps)({ reviewId: REVIEW_ID }, MANAGER)

    expect(result.outcome).toBe('not_on_google')
    expect(result.nextAutomaticCheckAt).toEqual(NEXT_CHECK)
    expect(googleReviewApi.getReview).toHaveBeenCalledOnce()
    expect(googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expectNoWriteToGoogle(harness)
  })
})
