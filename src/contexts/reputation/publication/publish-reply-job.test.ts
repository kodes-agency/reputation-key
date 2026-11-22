// A successful provider write waits for observation; an uncertain write is
// read back without resending. Only positive non-dispatch evidence permits
// another publication cycle. Capability denials are exercised at dispatch in
// publish-reply-gate.test.ts and shared/jobs/gated-dispatch.test.ts.

import { describe, it, expect } from 'vitest'
import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { createPublishReplyHandler } from './publish-reply-job.server'
import {
  NOW,
  JOB_DATA,
  approvedReply,
  review,
  gbpApiError,
  gbpRateLimited,
  connectionGone,
  tokenRefreshFailed,
  abortError,
  governedExecutorLostResponse,
  makeDeps,
  makeJob,
} from './publish-reply-job.test-fixtures'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

describe('publish-reply job handler', () => {
  it('skips a missing reply without claiming or sending', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue(null)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
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
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).not.toHaveBeenCalled()
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
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).not.toHaveBeenCalled()
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
    // Refused before or by Google: nothing was posted, and the notice says so.
    expect(event).toMatchObject({ outcome: 'refused' })
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).not.toHaveBeenCalled()
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
    // A retryable failure proves this attempt did not publish.
    expect(
      deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![2],
    ).toMatchObject({
      outcome: 'not_sent',
    })
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
    ['direct transport rejection', () => new TypeError('fetch failed'), false],
    ['governed executor lost response', governedExecutorLostResponse, true],
    ['5xx response without no-write evidence', () => gbpApiError(500), false],
  ])(
    '%s reads back but never treats a filtered absence as permission to resend',
    async (_label, makeFailure, isProviderFailure) => {
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
      const failure = makeFailure()
      deps.googleReviewApi.replyToReview.mockRejectedValueOnce(failure)
      const handler = createPublishReplyHandler(deps as never)

      // The job fails so BullMQ retries it: with the failure itself, or, for a
      // provider failure, with its Review error.
      await (isProviderFailure
        ? expect(handler(makeJob(0))).rejects.toMatchObject({
            _tag: 'GoogleReviewApiError',
            code: 'provider_unavailable',
            failure: { dispatch: 'unknown' },
          })
        : expect(handler(makeJob(0))).rejects.toBe(failure))
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
    // The reply may be live: the notice must not call it failed or offer a retry.
    expect(event).toMatchObject({ outcome: 'unconfirmed' })
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
    expect(
      deps.replyCommandStore.markPublicationTerminal.mock.calls[0]![2],
    ).toMatchObject({
      outcome: 'refused',
    })
  })
})
