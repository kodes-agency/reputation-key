// publish-reply job handler behavior.
// BQC-3.2: the BQC-0.4 in-handler capability stop control moved to the
// dispatch gate (src/shared/jobs/delayed-execution-gate.ts) — see
// gated-dispatch.test.ts and architecture/delayed-policy-delegation.test.ts.
// BQC-3.3: provider outcomes are classified via the reply-publication saga —
// terminal 4xx rejections mark publish_failed WITHOUT burning BullMQ retries,
// retryable failures rethrow for the configured attempts, and ambiguous
// outcomes (timeout/unknown after the request may have landed) admit one
// read-only retry before becoming publish_failed with a reconciliation deadline.
// BQC-3.8: the classification writes the DURABLE publication state machine —
// claim (sending), terminal, ambiguous (+ reconcile_due_at), retry-queued —
// and the post-call race guard refuses to mark a reply the disconnect
// cascade cancelled or purged while the Google call was in flight.
//
// Phase BQC-3 §6 external publication coverage lives here:
//   - timeout BEFORE the request (provider-classified pre-request failure);
//   - timeout DURING the request (abort → ambiguous);
//   - failure AFTER provider success BEFORE the local acknowledgement
//     (local outcome write fails → retry performs a targeted read first and
//     never blindly repeats the provider write).

import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { createGoogleAuthorizedProviderExecutor } from '#/contexts/integration/infrastructure/adapters/google-authorized-provider-executor.adapter'
import { createGoogleReviewApiAdapter } from '#/contexts/integration/infrastructure/adapters/google-review-api.adapter'
import { createSingle401RefreshExecutor } from '#/contexts/integration/infrastructure/adapters/google-single-401-refresh-executor'
import { integrationError } from '#/contexts/integration/domain/errors'
import {
  createReplyPublicationProviderCall,
  type GoogleReplyPublicationAuthorizationResult,
} from '#/contexts/integration/application/google-reply-publication-authorizer'
import { googleReplyTextDigest } from '#/shared/domain/google-reply-text'
import { createPublishReplyHandler } from './publish-reply.job'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const NOW = new Date('2026-07-17T00:00:00Z')
const JOB_DATA = {
  replyId: 'reply-1',
  organizationId: 'org-1',
  publicationCycle: 1,
  propertyId: 'prop-1',
  sourceEpoch: 0,
  materialReviewRevision: 1,
  baseObservationRevision: 0,
}

const approvedReply = {
  id: 'reply-1',
  reviewId: 'rev-1',
  organizationId: 'org-1',
  text: 'Thanks!',
  status: 'approved',
  source: 'internal',
  createdBy: 'user-1',
  approvedBy: 'user-1',
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  templateId: null,
  templateVersion: null,
  stateRevision: 1,
  submittedAt: NOW,
  approvedAt: NOW,
  publishedAt: null,
  publicationState: 'authorized',
  publicationCycle: 1,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const review = {
  id: 'rev-1',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  googleConnectionId: 'conn-1',
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  sourceEpoch: 0,
  sourceRevision: 1,
  replyStateRevision: 1,
  contentExpiresAt: new Date('2026-08-16T00:00:00Z'),
}

/** Error shape thrown by the Google review API adapter (integration context). */
function gbpApiError(status: number): Error {
  return Object.assign(new Error('Failed to reach Google review API'), {
    _tag: 'IntegrationError',
    code: 'gbp_api_error',
    context: { operation: 'reply', status, bodyBytes: 100 },
  })
}

function gbpRateLimited(): Error {
  return Object.assign(new Error('Failed to reach Google review API'), {
    _tag: 'IntegrationError',
    code: 'gbp_api_rate_limited',
    context: { operation: 'reply', status: 429, bodyBytes: 100 },
  })
}

/** Pre-request failure: the connection is gone before the PUT is ever sent. */
function connectionGone(): Error {
  return Object.assign(new Error('Google connection is disconnected'), {
    _tag: 'IntegrationError',
    code: 'connection_disconnected',
    context: {},
  })
}

/** Pre-request failure: token refresh failed before the PUT was sent. */
function tokenRefreshFailed(): Error {
  return Object.assign(new Error('Failed to refresh Google access token'), {
    _tag: 'IntegrationError',
    code: 'token_refresh_failed',
    context: {},
  })
}

function abortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

/** The review adapter's error, carrying the dispatch the provider plane recorded (D2). */
function reviewApiFailure(
  code: string,
  failure: Readonly<{
    executionCode: string | null
    dispatch: 'not_sent' | 'answered' | 'unknown'
    providerStatus: number | null
  }>,
): Error {
  const status =
    failure.providerStatus === null ? '' : `; status ${failure.providerStatus}`
  return Object.assign(
    new Error(
      `Google review API request failed (${failure.executionCode ?? code}; ${failure.dispatch}${status})`,
    ),
    { _tag: 'GoogleReviewApiError', code, recoverable: true, failure },
  )
}

function governedExecutorLostResponse(): Error {
  return Object.assign(new Error('governed provider execution failed after dispatch'), {
    _tag: 'GbpApiError',
    kind: 'upstream_error',
  })
}

function makeDeps() {
  const replyCommandStore = {
    submitReply: vi.fn(),
    rejectReply: vi.fn(),
    markPublished: vi.fn(async (reply: object, updates: object, _event: object) => ({
      ...reply,
      ...updates,
    })),
    markProviderOutcomePendingObservation: vi.fn(
      async (reply: object, _outcome: object) => ({
        ...reply,
        publicationState: 'pending_observation',
      }),
    ),
    markPublicationAuthorized: vi.fn(),
    markPublicationSending: vi.fn(async (reply: typeof approvedReply) =>
      reply.publicationState === 'authorized'
        ? {
            ...reply,
            publicationState: 'sending',
            publicationAttempts: reply.publicationAttempts + 1,
          }
        : null,
    ),
    markPublicationTerminal: vi.fn(
      async (reply: object, errorClass: string, _event: object) => ({
        ...reply,
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: errorClass,
      }),
    ),
    markPublicationAmbiguous: vi.fn(async (reply: object, _event: object) => ({
      ...reply,
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationLastErrorClass: 'ambiguous',
    })),
    markPublicationRetryQueued: vi.fn(async (reply: object) => ({
      ...reply,
      publicationState: 'authorized',
    })),
    deferUncertainSend: vi.fn(async (reply: object, dueAt: Date, _now: Date) => ({
      ...reply,
      reconcileDueAt: dueAt,
    })),
    rescheduleAmbiguousReconciliation: vi.fn(),
    settleNeverDispatchedAttempt: vi.fn(
      async (reply: object, _event: object | null, _now: Date) => ({
        ...reply,
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationLastErrorClass: 'retryable',
        reconcileDueAt: null,
      }),
    ),
    cancelPublications: vi.fn(),
    mirrorSyncedReply: vi.fn(),
    purgeExpiredReview: vi.fn(),
  }
  return {
    replyRepo: {
      findById: vi.fn().mockResolvedValue(approvedReply),
      // A BullMQ backoff retry reads back 15-30 s after the attempt started.
      findCurrentPublicationAttemptStartedAt: vi
        .fn()
        .mockResolvedValue(new Date(NOW.getTime() - 30_000)),
    },
    reviewRepo: { findById: vi.fn().mockResolvedValue(review) },
    dispatchEvidence: {
      findDispatchEvidence: vi.fn().mockResolvedValue('too_recent'),
    },
    googleReviewApi: {
      replyToReview: vi.fn().mockResolvedValue({ providerCorrelationId: 'google-1' }),
      getReview: vi.fn().mockResolvedValue({
        status: 'found',
        review: {
          reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
          replyText: 'Thanks!',
          replyUpdatedAt: NOW,
        },
      }),
    },
    googleReplyObservationStore: {
      allocateReadGeneration: vi.fn(async () => 1),
      record: vi.fn().mockResolvedValue({
        observationRevision: 1,
        change: 'added',
        resolution: 'confirmed_on_google',
        matchedReplyId: 'reply-1',
        matchedPublicationCycle: 1,
        duplicate: false,
      }),
    },
    replyCommandStore,
    clock: () => NOW,
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    idGen: () => 'reply-1',
    staffPublicApi: {},
  }
}

const makeJob = (attemptsMade = 0, data = JOB_DATA) =>
  ({ id: 'job-1', data, attemptsMade }) as never

const absentOnGoogle = () => ({
  status: 'found',
  review: {
    reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
    replyText: null,
    replyUpdatedAt: NOW,
  },
})

describe('publish-reply job handler', () => {
  it('runs without an in-handler capability gate (delegated to dispatch)', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue(null)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    // No gate in the handler: the repository is consulted directly
    // (reply not found → clean skip).
    expect(deps.replyRepo.findById).toHaveBeenCalledTimes(1)
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('success → records the provider outcome pending observation and does not publish', async () => {
    const deps = makeDeps()
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.markPublicationSending).toHaveBeenCalledTimes(1)
    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: 'prop-1',
      connectionId: 'conn-1',
      sourceEpoch: 0,
      reviewId: 'rev-1',
      materialReviewRevision: 1,
      replyId: 'reply-1',
      publicationCycle: 1,
      attemptNumber: 1,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      text: 'Thanks!',
    })
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ publicationState: 'sending', publicationCycle: 1 }),
      {
        providerCorrelationId: 'google-1',
        providerRespondedAt: NOW,
      },
      NOW,
    )
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('skips replies that are not in approved status (no claim, no send)', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue({ ...approvedReply, status: 'draft' })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('rejects a delayed job from an older publication cycle before claim or send', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue({
      ...approvedReply,
      publicationCycle: 2,
    })
    const handler = createPublishReplyHandler(deps as never)

    await handler(
      makeJob(0, {
        ...JOB_DATA,
        publicationCycle: 1,
      }),
    )

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('claim lost (cancelled or racing) → skips without the side effect or any mark', async () => {
    const deps = makeDeps()
    deps.replyCommandStore.markPublicationSending.mockResolvedValue(null)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('terminal provider rejection (4xx) → terminal mark WITHOUT burning retries (no rethrow)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpApiError(403))
    const handler = createPublishReplyHandler(deps as never)

    // First attempt, and the handler must NOT rethrow — remaining BullMQ
    // attempts must not be burned on a permanent rejection.
    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
      'terminal_rejection',
    )
    const event = deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![2] as {
      _tag: string
    }
    expect(event._tag).toBe('review.reply.publish_failed')
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('names the reconnect remedy on the publish_failed fact of a reply blocked by reauthorization', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(
      Object.assign(new Error('Google review API request failed'), {
        _tag: 'GoogleReviewApiError',
        code: 'reauthorization_required',
        recoverable: false,
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'reply-1' }),
      'terminal_rejection',
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        cause: 'google_reauthorization_required',
      }),
    )
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
  })

  it('names no cause for any other terminal refusal', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpApiError(403))
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(0))

    const event = deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![2]
    expect(event).not.toHaveProperty('cause')
  })

  it('429 rate limit retries within budget, then becomes publish_failed on attempt five', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpRateLimited())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toMatchObject({
      _tag: 'IntegrationError',
      code: 'gbp_api_rate_limited',
    })
    expect(deps.replyCommandStore.markPublicationRetryQueued).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()

    await expect(handler(makeJob(4))).rejects.toMatchObject({
      _tag: 'IntegrationError',
      code: 'gbp_api_rate_limited',
    })
    expect(deps.replyCommandStore.markPublicationRetryQueued).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
      'retryable',
    )
  })

  it('5xx provider error → ambiguous, preserving sending until targeted readback', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpApiError(500))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toMatchObject({
      _tag: 'IntegrationError',
      code: 'gbp_api_error',
    })
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()

    await expect(handler(makeJob(4))).rejects.toMatchObject({
      _tag: 'IntegrationError',
      code: 'gbp_api_error',
    })
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('network TypeError → ambiguous (state stays sending before final attempt)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(new TypeError('fetch failed'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow(TypeError)
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it.each([
    ['direct transport rejection', () => new TypeError('fetch failed')],
    ['governed executor lost response', governedExecutorLostResponse],
    ['5xx response without no-write evidence', () => gbpApiError(500)],
  ])(
    '%s reads back but never treats a filtered absence as permission to resend',
    async (_label, makeFailure) => {
      let current = { ...approvedReply }
      const deps = makeDeps()
      deps.replyRepo.findById.mockImplementation(async () => current)
      deps.replyCommandStore.markPublicationSending.mockImplementation(async () => {
        if (
          current.publicationState !== 'authorized' &&
          current.publicationState !== 'sending'
        ) {
          return null
        }
        current = {
          ...current,
          publicationState: 'sending',
          publicationAttempts: current.publicationAttempts + 1,
        }
        return current
      })
      deps.googleReviewApi.getReview.mockResolvedValue({
        status: 'found',
        review: {
          reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
          replyText: null,
          replyUpdatedAt: NOW,
        },
      })
      deps.googleReviewApi.replyToReview.mockRejectedValueOnce(makeFailure())
      const handler = createPublishReplyHandler(deps as never)

      await expect(handler(makeJob(0))).rejects.toBeInstanceOf(Error)
      await expect(handler(makeJob(1))).resolves.toBeUndefined()

      expect(deps.googleReviewApi.getReview).toHaveBeenCalledOnce()
      expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledOnce()
      // D3: one absent read inside the propagation grace is not ambiguity.
      expect(deps.replyCommandStore.deferUncertainSend).toHaveBeenCalledOnce()
      expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    },
  )

  it('§6 timeout BEFORE the request: token refresh failure → retryable (provider never saw a request)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(tokenRefreshFailed())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toMatchObject({
      _tag: 'IntegrationError',
      code: 'token_refresh_failed',
    })
    expect(deps.replyCommandStore.markPublicationRetryQueued).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('§6 timeout BEFORE the request: connection gone → provider-classified terminal (no retry burn)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(connectionGone())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).resolves.toBeUndefined()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledTimes(1)
  })

  it('§6 abort DURING the request → ambiguous: rethrows, state stays sending (no mark) before the final attempt', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(abortError())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow('The operation was aborted')
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
  })

  it('§6 abort DURING the request on the FINAL attempt → ambiguous mark + reconcile schedule (honest unknown)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(abortError())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(4))).rejects.toThrow('The operation was aborted')
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledTimes(1)
    const event = deps.replyCommandStore.markPublicationAmbiguous.mock.calls[0]![1] as {
      _tag: string
    }
    expect(event._tag).toBe('review.reply.publish_failed')
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('unknown error → treated as ambiguous; final attempt marks ambiguous', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(new Error('socket hangup'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow('socket hangup')
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()

    await expect(handler(makeJob(4))).rejects.toThrow('socket hangup')
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledTimes(1)
  })

  it('missing Google connection → terminal mark (no send, no rethrow)', async () => {
    const deps = makeDeps()
    deps.reviewRepo.findById.mockResolvedValue({ ...review, googleConnectionId: null })
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
      'terminal_rejection',
    )
  })

  it('persisted sending + lost provider subject remains check-only', async () => {
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.reviewRepo.findById.mockResolvedValue({ ...review, googleConnectionId: null })
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.googleReviewApi.getReview).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    // Loss of read access is not a read: ambiguous at once, first ladder rung.
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      sending,
      expect.objectContaining({ _tag: 'review.reply.publish_failed' }),
      NOW,
      new Date(NOW.getTime() - 30_000 + 15 * 60_000),
    )
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('post-call race guard: reply purged during the Google call → returns WITHOUT marking published', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById
      .mockResolvedValueOnce(approvedReply) // initial read
      .mockResolvedValueOnce(null) // post-call re-read — purge cascade won
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('post-call race guard: publication cancelled during the Google call → returns WITHOUT marking published', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById
      .mockResolvedValueOnce(approvedReply) // initial read
      .mockResolvedValueOnce({
        ...approvedReply,
        status: 'draft',
        publicationState: 'cancelled',
      }) // post-call re-read — disconnect won the race
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('post-call cycle fence: a newer authorization cannot be acknowledged by the older send', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValueOnce(approvedReply).mockResolvedValueOnce({
      ...approvedReply,
      publicationCycle: 2,
    })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('acknowledgement compare-and-set fences a cycle change after the post-call read', async () => {
    const deps = makeDeps()
    deps.replyCommandStore.markProviderOutcomePendingObservation.mockResolvedValueOnce(
      null as never,
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(1)
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).toHaveBeenCalledTimes(1)
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation.mock.calls[0]![0],
    ).toMatchObject({
      publicationCycle: 1,
      publicationState: 'sending',
    })
  })

  it('§6 failure AFTER provider success BEFORE local outcome persistence: retry reads back and never blindly sends a second PUT', async () => {
    // @proof REPLY_PUBLICATION_CRASH#1
    // Stateful fake: the row persists publication_state across the two runs,
    // exactly as the atomic store would leave it ('sending' after run 1's
    // claim; the failed markPublished never committed).
    let current = { ...approvedReply }
    const deps = makeDeps()
    deps.replyRepo.findById.mockImplementation(async () => current)
    deps.replyCommandStore.markPublicationSending.mockImplementation(async () => {
      if (
        current.publicationState !== 'authorized' &&
        current.publicationState !== 'sending'
      )
        return null
      current = {
        ...current,
        publicationState: 'sending',
        publicationAttempts: current.publicationAttempts + 1,
      }
      return current
    })
    deps.replyCommandStore.markProviderOutcomePendingObservation.mockRejectedValueOnce(
      new Error('db write failed'),
    ) // local outcome persistence fails AFTER provider success
    const handler = createPublishReplyHandler(deps as never)

    // Run 1: provider call succeeds, the local ack fails → ambiguous
    // non-final → rethrow for BullMQ retry; state stays 'sending'.
    await expect(handler(makeJob(0))).rejects.toThrow('db write failed')
    expect(current.publicationState).toBe('sending')
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()

    // Run 2: persisted sending means the prior outcome is uncertain. The
    // worker first reads the targeted review; an exact current observation is
    // handed to the observation authority and the provider write is not
    // repeated.
    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(1)
    expect(deps.googleReviewApi.getReview).toHaveBeenCalledTimes(1)
    expect(deps.googleReviewApi.getReview.mock.invocationCallOrder[0]).toBeLessThan(
      deps.googleReplyObservationStore.allocateReadGeneration.mock
        .invocationCallOrder[0]!,
    )
    expect(deps.googleReplyObservationStore.record).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: 'rev-1',
        observedText: 'Thanks!',
        source: 'targeted_reconciliation',
      }),
    )
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('a persisted uncertain attempt records absence, waits inside the grace and never repeats the provider write', async () => {
    // Incident b129e390: attempt 2 read Google once ~30 s after the send and
    // marked the reply ambiguous ("Needs a check") on that single absence.
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.googleReviewApi.getReview.mockResolvedValue(absentOnGoogle())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.googleReviewApi.getReview).toHaveBeenCalledOnce()
    expect(deps.googleReplyObservationStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ observedText: null }),
    )
    expect(deps.replyCommandStore.deferUncertainSend).toHaveBeenCalledWith(
      sending,
      new Date(NOW.getTime() + 60_000),
      NOW,
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('an absent readback past the grace becomes ambiguous on the read ladder', async () => {
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    const attemptStartedAt = new Date(NOW.getTime() - 15 * 60_000)
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.replyRepo.findCurrentPublicationAttemptStartedAt.mockResolvedValue(
      attemptStartedAt,
    )
    deps.googleReviewApi.getReview.mockResolvedValue(absentOnGoogle())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      sending,
      expect.objectContaining({ _tag: 'review.reply.publish_failed' }),
      NOW,
      new Date(attemptStartedAt.getTime() + 30 * 60_000),
    )
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('never-dispatched evidence settles the attempt as not published without reading Google', async () => {
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    const attemptStartedAt = new Date(NOW.getTime() - 6 * 60_000)
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.replyRepo.findCurrentPublicationAttemptStartedAt.mockResolvedValue(
      attemptStartedAt,
    )
    deps.dispatchEvidence.findDispatchEvidence.mockResolvedValue('never_dispatched')
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.replyRepo.findCurrentPublicationAttemptStartedAt).toHaveBeenCalledWith({
      organizationId: 'org-1',
      reviewId: 'rev-1',
      replyId: 'reply-1',
      publicationCycle: 1,
      attemptNumber: 1,
    })
    expect(deps.dispatchEvidence.findDispatchEvidence).toHaveBeenCalledWith({
      organizationId: 'org-1',
      replyId: 'reply-1',
      publicationCycle: 1,
      attemptNumber: 1,
      attemptStartedAt,
      now: NOW,
    })
    expect(deps.replyCommandStore.settleNeverDispatchedAttempt).toHaveBeenCalledWith(
      sending,
      expect.objectContaining({ _tag: 'review.reply.publish_failed' }),
      NOW,
    )
    expect(deps.googleReviewApi.getReview).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
  })

  it.each(['possibly_dispatched', 'too_recent'] as const)(
    '%s evidence keeps the read-only path',
    async (evidence) => {
      const deps = makeDeps()
      deps.replyRepo.findById.mockResolvedValue({
        ...approvedReply,
        publicationState: 'sending',
        publicationAttempts: 1,
      })
      deps.dispatchEvidence.findDispatchEvidence.mockResolvedValue(evidence)
      const handler = createPublishReplyHandler(deps as never)

      await expect(handler(makeJob(1))).resolves.toBeUndefined()

      expect(deps.googleReviewApi.getReview).toHaveBeenCalledOnce()
      expect(deps.replyCommandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    },
  )

  it('an unavailable evidence read is not evidence: the job reads Google instead', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue({
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    })
    deps.dispatchEvidence.findDispatchEvidence.mockRejectedValue(
      Object.assign(new Error('permit lookup failed'), { code: '57014' }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.googleReviewApi.getReview).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
  })

  it.each([
    [
      'an unreadable reply comment',
      {
        read: () => ({
          status: 'found',
          review: {
            reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
            replyText: null,
            replyUnreadable: true,
            replyUpdatedAt: NOW,
          },
        }),
        resolution: 'unchanged',
        reason: 'reply_unreadable',
        records: false,
      },
    ],
    [
      'a whitespace-only difference',
      {
        read: () => ({
          status: 'found',
          review: {
            reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
            replyText: 'Thanks!  ',
            replyUpdatedAt: NOW,
          },
        }),
        resolution: 'diverged',
        reason: 'whitespace_only_difference',
        records: true,
      },
    ],
  ])('%s neither confirms nor ends the wait', async (_label, scenario) => {
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.googleReviewApi.getReview.mockResolvedValue(scenario.read())
    deps.googleReplyObservationStore.record.mockResolvedValue({
      observationRevision: 1,
      change: 'added',
      resolution: scenario.resolution,
      matchedReplyId: null,
      matchedPublicationCycle: null,
      duplicate: false,
    })
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.googleReplyObservationStore.record).toHaveBeenCalledTimes(
      scenario.records ? 1 : 0,
    )
    expect(deps.replyCommandStore.deferUncertainSend).toHaveBeenCalledWith(
      sending,
      new Date(NOW.getTime() + 60_000),
      NOW,
    )
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: scenario.reason }),
      expect.any(String),
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('a missing attempt start fails closed to ambiguity without consulting evidence', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue({
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    })
    deps.replyRepo.findCurrentPublicationAttemptStartedAt.mockResolvedValue(null)
    deps.googleReviewApi.getReview.mockResolvedValue(absentOnGoogle())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledOnce()
  })

  it('a compile refusal on attempt 1 is terminal: no readback and no second write', async () => {
    // Incident b129e390: the executor refused to compile the body (no permit,
    // no fetch) and the job kept the row `sending`, so attempt 2 read Google
    // once and parked the reply as "Needs a check".
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(
      reviewApiFailure('provider_unavailable', {
        executionCode: 'malformed_request',
        dispatch: 'not_sent',
        providerStatus: null,
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
      'terminal_rejection',
    )
    expect(deps.googleReviewApi.getReview).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
  })

  it('a not_sent coordination outage queues a retry instead of an uncertain send', async () => {
    const deps = makeDeps()
    const failure = reviewApiFailure('provider_unavailable', {
      executionCode: 'coordination_unavailable',
      dispatch: 'not_sent',
      providerStatus: null,
    })
    deps.googleReviewApi.replyToReview.mockRejectedValue(failure)
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toBe(failure)

    expect(deps.replyCommandStore.markPublicationRetryQueued).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it.each([
    [
      'terminal_rejection',
      { executionCode: 'malformed_request', dispatch: 'not_sent', providerStatus: null },
      0,
    ],
    [
      'retryable',
      {
        executionCode: 'coordination_unavailable',
        dispatch: 'not_sent',
        providerStatus: null,
      },
      0,
    ],
    ['ambiguous', { executionCode: null, dispatch: 'answered', providerStatus: 503 }, 0],
    ['ambiguous', { executionCode: null, dispatch: 'unknown', providerStatus: null }, 4],
  ] as const)(
    'logs a classified %s failure with its dispatch evidence and no content',
    async (failureClass, failure, attemptsMade) => {
      const deps = makeDeps()
      const text = 'Thank you, Maria.\nSee you again soon!'
      deps.replyRepo.findById.mockResolvedValue({ ...approvedReply, text })
      // Even an error whose own message echoes the reply must not reach a log.
      deps.googleReviewApi.replyToReview.mockRejectedValue(
        Object.assign(reviewApiFailure('provider_unavailable', failure), {
          message: `refused: ${text}`,
        }),
      )
      const handler = createPublishReplyHandler(deps as never)

      await handler(makeJob(attemptsMade)).catch(() => undefined)

      const logged = [
        ...deps.logger.error.mock.calls,
        ...deps.logger.warn.mock.calls,
        ...deps.logger.info.mock.calls,
      ]
      expect(deps.logger.error).toHaveBeenCalledWith(
        {
          attempt: attemptsMade + 1,
          failureClass,
          executionCode: failure.executionCode,
          dispatch: failure.dispatch,
          providerStatus: failure.providerStatus,
          errorName: 'Error',
          errorCode: 'provider_unavailable',
        },
        expect.any(String),
      )
      for (const args of logged) {
        for (const arg of args) expect(arg).not.toBeInstanceOf(Error)
      }
      expect(JSON.stringify(logged)).not.toContain('Maria')
    },
  )

  // A failure with no dispatch evidence logs the same five fields whatever
  // threw. Without the error's own name and code, "Google accepted the write
  // and only the local acknowledgement failed" (a Postgres error after the 200)
  // was indistinguishable from a transport failure, which is the evidence an
  // operator needs before any manual retry.
  it('logs the name and code of a local error thrown after Google accepted the write', async () => {
    const deps = makeDeps()
    deps.replyCommandStore.markProviderOutcomePendingObservation.mockRejectedValue(
      Object.assign(new Error('could not serialize access: Thank you, Maria.'), {
        name: 'DatabaseError',
        code: '40001',
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(0)).catch(() => undefined)

    expect(deps.logger.error).toHaveBeenCalledWith(
      {
        attempt: 1,
        failureClass: 'ambiguous',
        executionCode: null,
        dispatch: 'unknown',
        providerStatus: null,
        errorName: 'DatabaseError',
        errorCode: '40001',
      },
      expect.any(String),
    )
    expect(JSON.stringify(deps.logger.error.mock.calls)).not.toContain('Maria')
  })

  it.each([
    ['a thrown string', 'Thank you, Maria.'],
    [
      'an error whose name and code are not identifiers',
      Object.assign(new Error('boom'), {
        name: 'Thank you, Maria.',
        code: 'Thank you, Maria.',
      }),
    ],
  ])('logs no error identity for %s', async (_label, thrown) => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(thrown)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(0)).catch(() => undefined)

    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: null, errorCode: null }),
      expect.any(String),
    )
    expect(JSON.stringify(deps.logger.error.mock.calls)).not.toContain('Maria')
  })

  it('a failed targeted readback keeps an uncertain attempt from sending', async () => {
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.googleReviewApi.getReview.mockRejectedValue(new Error('readback unavailable'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).rejects.toThrow('readback unavailable')

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    // A failed read is not a result: inside the grace the send keeps waiting.
    expect(deps.replyCommandStore.deferUncertainSend).toHaveBeenCalledWith(
      sending,
      new Date(NOW.getTime() + 60_000),
      NOW,
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
  })

  it('a failed targeted readback past the grace becomes ambiguous on the ladder', async () => {
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    const attemptStartedAt = new Date(NOW.getTime() - 20 * 60_000)
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.replyRepo.findCurrentPublicationAttemptStartedAt.mockResolvedValue(
      attemptStartedAt,
    )
    deps.googleReviewApi.getReview.mockRejectedValue(new Error('readback unavailable'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).rejects.toThrow('readback unavailable')

    expect(deps.replyCommandStore.deferUncertainSend).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).toHaveBeenCalledWith(
      sending,
      expect.objectContaining({ _tag: 'review.reply.publish_failed' }),
      NOW,
      new Date(attemptStartedAt.getTime() + 30 * 60_000),
    )
  })
})

// Incident b129e390 end to end: the publish job over the REAL review API
// adapter and the REAL authorized executor (so the real route-catalogue
// compile runs); only permit admission and the egress gateway are fakes, so
// nothing can reach Google. The incident reply had three line feeds.
describe('publish-reply job over the real provider adapters (incident b129e390)', () => {
  const ORG = '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC'
  const IDS = {
    property: '00000000-0000-4000-8000-00000000a001',
    connection: '00000000-0000-4000-8000-00000000a002',
    review: '00000000-0000-4000-8000-00000000a003',
    reply: '00000000-0000-4000-8000-00000000a004',
  }
  const INCIDENT_TEXT =
    'Thank you for staying with us.\nWe are glad the room was quiet.\nSee you next time!\n'
  // The route catalogue refuses every C0 control in a header field, so this
  // credential makes the REAL compile step refuse the request, as the incident
  // reply's body was refused before line feeds were allowed in the comment.
  const UNCOMPILABLE_TOKEN = `ya29.access${String.fromCharCode(1)}token`

  function incidentDeps(
    accessToken = 'ya29.access-token',
    refusal: GoogleReplyPublicationAuthorizationResult | null = null,
  ) {
    const deps = makeDeps()
    let current = {
      ...approvedReply,
      id: IDS.reply,
      reviewId: IDS.review,
      organizationId: ORG,
      text: INCIDENT_TEXT,
    }
    deps.replyRepo.findById.mockImplementation(async () => current)
    deps.replyCommandStore.markPublicationSending.mockImplementation(async () => {
      if (current.publicationState !== 'authorized') return null
      current = {
        ...current,
        publicationState: 'sending',
        publicationAttempts: current.publicationAttempts + 1,
      }
      return current
    })
    deps.reviewRepo.findById.mockResolvedValue({
      ...review,
      id: IDS.review,
      organizationId: ORG,
      propertyId: IDS.property,
      googleConnectionId: IDS.connection,
    })
    const gateway = {
      execute: vi.fn(async () => ({
        ok: true as const,
        status: 200,
        headers: {
          contentType: 'application/json; charset=utf-8',
          cacheControl: null,
          retryAfter: null,
          providerCorrelationId: 'google-request-1',
        },
        body: new TextEncoder().encode('{}'),
      })),
    }
    const admit = vi.fn(async () => ({ ok: true as const, permitId: 'permit-1' }))
    const executor = createGoogleAuthorizedProviderExecutor({
      bindCredential: (credential) =>
        createHash('sha256').update(credential, 'utf8').digest('hex'),
      admit,
      gateway,
    })
    const googleReviewApi = createGoogleReviewApiAdapter({
      connectionRepo: { findById: vi.fn() } as never,
      logger: { warn: vi.fn() } as never,
      cursorStore: {} as never,
      executor,
      authorizeReplyPublicationProviderCall: vi.fn(async (input) =>
        refusal
          ? createReplyPublicationProviderCall(async () => refusal)(input)
          : {
              accessToken,
              authorization: {
                capability: 'property.publish_reply' as const,
                organizationId: input.organizationId,
                propertyId: input.propertyId,
                connectionId: input.connectionId,
                initiatorUserId: null,
                expectedCredentialGeneration: 1,
                authorizationVector: {
                  generation: 1,
                  propertySourceEpoch: input.sourceEpoch,
                  publicationCycle: input.publicationCycle,
                  publicationAttemptNumber: input.attemptNumber,
                  expectedReplyDigest: googleReplyTextDigest(INCIDENT_TEXT),
                },
                publication: {
                  reviewId: input.reviewId,
                  replyId: input.replyId,
                  publicationCycle: input.publicationCycle,
                  attemptNumber: input.attemptNumber,
                  sourceEpoch: input.sourceEpoch,
                  materialReviewRevision: input.materialReviewRevision,
                },
              },
            },
      ),
      nowMs: () => NOW.getTime(),
    })
    const getReview = vi.fn(googleReviewApi.getReview)
    const handler = createPublishReplyHandler({
      ...deps,
      googleReviewApi: { ...googleReviewApi, getReview },
    } as never)
    const job = makeJob(0, {
      ...JOB_DATA,
      replyId: IDS.reply,
      organizationId: ORG,
      propertyId: IDS.property,
    })
    return { deps, handler, gateway, admit, getReview, job }
  }

  it('sends the line-feed reply once and waits for observation, never ambiguous', async () => {
    const { deps, handler, gateway, getReview, job } = incidentDeps()

    await expect(handler(job)).resolves.toBeUndefined()

    expect(gateway.execute).toHaveBeenCalledOnce()
    expect(gateway.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        descriptor: expect.objectContaining({
          routeKey: 'reviews.reply',
          comment: INCIDENT_TEXT,
        }),
      }),
    )
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).toHaveBeenCalledOnce()
    expect(getReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('a real compile refusal ends terminal on attempt 1: no permit, no fetch, no readback', async () => {
    const { deps, handler, gateway, admit, getReview, job } =
      incidentDeps(UNCOMPILABLE_TOKEN)

    await expect(handler(job)).resolves.toBeUndefined()

    expect(admit).not.toHaveBeenCalled()
    expect(gateway.execute).not.toHaveBeenCalled()
    expect(getReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
      'terminal_rejection',
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
    expect(deps.logger.error).toHaveBeenCalledWith(
      {
        attempt: 1,
        failureClass: 'terminal_rejection',
        executionCode: 'malformed_request',
        dispatch: 'not_sent',
        providerStatus: null,
        errorName: 'GoogleReviewApiError',
        errorCode: 'provider_unavailable',
      },
      expect.any(String),
    )
    expect(JSON.stringify(deps.logger.error.mock.calls)).not.toContain('quiet')
  })

  // An Archive or Restore committed after the claim: RepKey's own authorizer
  // refuses the write because the Property is no longer active at the cycle's
  // source epoch. Nothing reached Google, so the author must not hear "Google
  // rejected the reply": the cycle is cancelled as a policy cancellation.
  it('cancels a cycle the authorizer refused for a moved Property source as policy', async () => {
    const { deps, handler, gateway, admit, getReview, job } = incidentDeps(
      'ya29.access-token',
      { ok: false, code: 'stale_source' },
    )
    deps.replyCommandStore.cancelPublications.mockResolvedValue(1)

    await expect(handler(job)).resolves.toBeUndefined()

    expect(admit).not.toHaveBeenCalled()
    expect(gateway.execute).not.toHaveBeenCalled()
    expect(getReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledWith([
      {
        reply: expect.objectContaining({
          id: IDS.reply,
          publicationState: 'sending',
          publicationAttempts: 1,
        }),
        event: expect.objectContaining({
          _tag: 'review.reply.publication_cancelled',
          replyId: IDS.reply,
          reviewId: IDS.review,
          propertyId: IDS.property,
          organizationId: ORG,
          cause: 'policy',
          occurredAt: NOW,
        }),
        now: NOW,
      },
    ])
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
  })

  it.each(['authorization_denied', 'runtime_unavailable'] as const)(
    'keeps a %s refusal a terminal rejection',
    async (code) => {
      const { deps, handler, job } = incidentDeps('ya29.access-token', {
        ok: false,
        code,
      })

      await expect(handler(job)).resolves.toBeUndefined()

      expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
      expect(deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![1]).toBe(
        'terminal_rejection',
      )
    },
  )
})

// Google revoked the grant: the reply PUT is answered 401 and the forced
// refresh is refused for good. Over the REAL executor, 401-refresh wrapper and
// review API adapter (only permit admission, the gateway and the refresh are
// fakes), the reply used to read as an unknown dispatch, stayed "sending" and
// ended on the 72-hour read ladder with "Google rejected the reply".
describe('publish-reply job when Google revoked the grant (real provider adapters)', () => {
  const ORG = '0UM0PoDLJNJ3yGCeBMERaQkQyxer9BuC'
  const IDS = {
    property: '00000000-0000-4000-8000-00000000b001',
    connection: '00000000-0000-4000-8000-00000000b002',
    review: '00000000-0000-4000-8000-00000000b003',
    reply: '00000000-0000-4000-8000-00000000b004',
  }

  function revokedGrantDeps(authorize: 'authorized' | 'refused' = 'authorized') {
    const deps = makeDeps()
    let current = {
      ...approvedReply,
      id: IDS.reply,
      reviewId: IDS.review,
      organizationId: ORG,
    }
    deps.replyRepo.findById.mockImplementation(async () => current)
    deps.replyCommandStore.markPublicationSending.mockImplementation(async () => {
      if (current.publicationState !== 'authorized') return null
      current = {
        ...current,
        publicationState: 'sending',
        publicationAttempts: current.publicationAttempts + 1,
      }
      return current
    })
    deps.reviewRepo.findById.mockResolvedValue({
      ...review,
      id: IDS.review,
      organizationId: ORG,
      propertyId: IDS.property,
      googleConnectionId: IDS.connection,
    })
    const gateway = {
      execute: vi.fn(async () => ({
        ok: true as const,
        status: 401,
        headers: {
          contentType: 'application/json; charset=utf-8',
          cacheControl: null,
          retryAfter: null,
        },
        body: new TextEncoder().encode('{"error":{"status":"UNAUTHENTICATED"}}'),
      })),
    }
    const refreshAccessToken = vi.fn(async () => {
      throw integrationError(
        'reauthorization_required',
        'Google connection requires reauthorization',
      )
    })
    const executor = createSingle401RefreshExecutor({
      executor: createGoogleAuthorizedProviderExecutor({
        bindCredential: (credential) =>
          createHash('sha256').update(credential, 'utf8').digest('hex'),
        admit: vi.fn(async () => ({ ok: true as const, permitId: 'permit-1' })),
        gateway,
      }),
      refreshAccessToken,
      getAccessToken: async () => 'unused-access-token',
      reauthorize: async ({ authorization }) => authorization,
    })
    const googleReviewApi = createGoogleReviewApiAdapter({
      // The refresh use case has moved the connection to reauth_required.
      connectionRepo: {
        findById: vi.fn(async () => ({ status: 'reauth_required' })),
      } as never,
      logger: { warn: vi.fn() } as never,
      cursorStore: {} as never,
      executor,
      authorizeReplyPublicationProviderCall: vi.fn(async (input) => {
        if (authorize === 'refused') {
          throw new Error(
            'Google reply publication authorization is unavailable: runtime_unavailable',
          )
        }
        return {
          accessToken: 'ya29.revoked-access-token',
          authorization: {
            capability: 'property.publish_reply' as const,
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            connectionId: input.connectionId,
            initiatorUserId: null,
            expectedCredentialGeneration: 1,
            authorizationVector: {
              generation: 1,
              propertySourceEpoch: input.sourceEpoch,
              publicationCycle: input.publicationCycle,
              publicationAttemptNumber: input.attemptNumber,
              expectedReplyDigest: googleReplyTextDigest(approvedReply.text),
            },
            publication: {
              reviewId: input.reviewId,
              replyId: input.replyId,
              publicationCycle: input.publicationCycle,
              attemptNumber: input.attemptNumber,
              sourceEpoch: input.sourceEpoch,
              materialReviewRevision: input.materialReviewRevision,
            },
          },
        }
      }),
      nowMs: () => NOW.getTime(),
    })
    const handler = createPublishReplyHandler({ ...deps, googleReviewApi } as never)
    const job = makeJob(0, {
      ...JOB_DATA,
      replyId: IDS.reply,
      organizationId: ORG,
      propertyId: IDS.property,
    })
    return { deps, handler, gateway, refreshAccessToken, job }
  }

  const expectTerminalWithReconnectCause = (deps: ReturnType<typeof makeDeps>) => {
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledOnce()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply }),
      'terminal_rejection',
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        cause: 'google_reauthorization_required',
      }),
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
  }

  it('ends a reply answered 401 terminal on attempt 1, naming the reconnect remedy', async () => {
    const { deps, handler, gateway, refreshAccessToken, job } = revokedGrantDeps()

    await expect(handler(job)).resolves.toBeUndefined()

    expect(gateway.execute).toHaveBeenCalledOnce()
    expect(refreshAccessToken).toHaveBeenCalledOnce()
    expectTerminalWithReconnectCause(deps)
  })

  it('ends a reply whose publication authority was refused the same way, sending nothing', async () => {
    const { deps, handler, gateway, job } = revokedGrantDeps('refused')

    await expect(handler(job)).resolves.toBeUndefined()

    expect(gateway.execute).not.toHaveBeenCalled()
    expectTerminalWithReconnectCause(deps)
  })
})
