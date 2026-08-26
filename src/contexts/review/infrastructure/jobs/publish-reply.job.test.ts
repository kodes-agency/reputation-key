// publish-reply job handler behavior.
// BQC-3.2: the BQC-0.4 in-handler capability stop control moved to the
// dispatch gate (src/shared/jobs/delayed-execution-gate.ts) — see
// gated-dispatch.test.ts and architecture/delayed-policy-delegation.test.ts.
// BQC-3.3: provider outcomes are classified via the reply-publication saga —
// terminal 4xx rejections mark publish_failed WITHOUT burning BullMQ retries,
// retryable failures rethrow for the configured attempts, and ambiguous
// outcomes (timeout/unknown after the request may have landed) only mark
// publish_failed on the final attempt, with a reconciliation hint.
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
import { describe, it, expect, vi } from 'vitest'
import { createPublishReplyHandler } from './publish-reply.job'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}))
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
      reply.publicationState === 'authorized' || reply.publicationState === 'sending'
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
    cancelPublications: vi.fn(),
    mirrorSyncedReply: vi.fn(),
    purgeExpiredReview: vi.fn(),
  }
  return {
    replyRepo: { findById: vi.fn().mockResolvedValue(approvedReply) },
    reviewRepo: { findById: vi.fn().mockResolvedValue(review) },
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
    idGen: () => 'reply-1',
    staffPublicApi: {},
  }
}

const makeJob = (attemptsMade = 0, data = JOB_DATA) =>
  ({ id: 'job-1', data, attemptsMade }) as never

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
    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledWith(
      'org-1',
      'conn-1',
      GOOGLE_REVIEW_PRIMARY_RESOURCE,
      'Thanks!',
    )
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

  it('429 rate limit → retry-queued + rethrows for BullMQ retry (never a terminal mark)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpRateLimited())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toMatchObject({
      _tag: 'IntegrationError',
      code: 'gbp_api_rate_limited',
    })
    expect(deps.replyCommandStore.markPublicationRetryQueued).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()

    // Final attempt: a retryable failure is still retry-queued, never
    // marked failed — the exhausted job lands in quarantine with the row
    // back in 'authorized' for a redrive.
    await expect(handler(makeJob(2))).rejects.toMatchObject({
      _tag: 'IntegrationError',
      code: 'gbp_api_rate_limited',
    })
    expect(deps.replyCommandStore.markPublicationRetryQueued).toHaveBeenCalledTimes(2)
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
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

    await expect(handler(makeJob(2))).rejects.toMatchObject({
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
  ])('%s performs a targeted GET before any resend', async (_label, makeFailure) => {
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
    deps.replyCommandStore.markPublicationRetryQueued.mockImplementation(async () => {
      current = { ...current, publicationState: 'authorized' }
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
    deps.googleReviewApi.replyToReview
      .mockRejectedValueOnce(makeFailure())
      .mockResolvedValueOnce({ providerCorrelationId: 'google-resend' })
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toBeInstanceOf(Error)
    expect(current.publicationState).toBe('sending')

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(2)
    expect(deps.googleReviewApi.getReview).toHaveBeenCalledTimes(1)
    const readOrder = deps.googleReviewApi.getReview.mock.invocationCallOrder[0]!
    const resendOrder = deps.googleReviewApi.replyToReview.mock.invocationCallOrder[1]!
    expect(readOrder).toBeLessThan(resendOrder)
  })

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

    await expect(handler(makeJob(2))).rejects.toThrow('The operation was aborted')
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

    await expect(handler(makeJob(2))).rejects.toThrow('socket hangup')
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

  it('a persisted uncertain attempt resends only after targeted readback proves absence', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue({
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    })
    deps.googleReviewApi.getReview.mockResolvedValue({
      status: 'found',
      review: {
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
        replyText: null,
        replyUpdatedAt: NOW,
      },
    })
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).resolves.toBeUndefined()

    expect(deps.googleReviewApi.getReview).toHaveBeenCalledTimes(1)
    expect(deps.googleReplyObservationStore.record).toHaveBeenCalledWith(
      expect.objectContaining({ observedText: null }),
    )
    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(1)
    expect(deps.googleReviewApi.getReview.mock.invocationCallOrder[0]).toBeLessThan(
      deps.googleReviewApi.replyToReview.mock.invocationCallOrder[0]!,
    )
  })

  it('a failed targeted readback keeps an uncertain attempt from sending', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue({
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    })
    deps.googleReviewApi.getReview.mockRejectedValue(new Error('readback unavailable'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).rejects.toThrow('readback unavailable')

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('gives consecutive uncertain readbacks distinct fenced identities', async () => {
    const deps = makeDeps()
    let current = {
      ...approvedReply,
      publicationState: 'sending' as const,
      publicationAttempts: 1,
    }
    deps.replyRepo.findById.mockImplementation(async () => current)
    deps.googleReviewApi.getReview.mockResolvedValue({
      status: 'found',
      review: {
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
        replyText: null,
        replyUpdatedAt: null,
      },
    })
    deps.googleReplyObservationStore.allocateReadGeneration
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(11)
    deps.googleReviewApi.replyToReview.mockRejectedValue(abortError())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).rejects.toThrow('aborted')
    current = { ...current, publicationAttempts: 2 }
    await expect(handler(makeJob(2))).rejects.toThrow('aborted')

    const first = deps.googleReplyObservationStore.record.mock.calls[0]?.[0]
    const second = deps.googleReplyObservationStore.record.mock.calls[1]?.[0]
    expect(first).toMatchObject({
      readGeneration: 10,
      observedText: null,
      publicationTarget: { publicationCycle: 1, attemptNumber: 1 },
    })
    expect(second).toMatchObject({
      readGeneration: 11,
      observedText: null,
      publicationTarget: { publicationCycle: 1, attemptNumber: 2 },
    })
    expect(first?.observationKey).not.toBe(second?.observationKey)
    expect(deps.googleReviewApi.getReview).toHaveBeenCalledTimes(2)
    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(2)
  })
})
