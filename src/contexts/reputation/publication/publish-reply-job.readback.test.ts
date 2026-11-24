import { describe, it, expect } from 'vitest'
import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { createPublishReplyHandler } from './publish-reply-job.server'
import {
  NOW,
  approvedReply,
  review,
  reviewApiFailure,
  makeDeps,
  makeJob,
  absentOnGoogle,
} from './publish-reply-job.test-fixtures'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

describe('publish-reply job handler', () => {
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
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'unconfirmed',
      }),
      NOW,
      new Date(NOW.getTime() - 30_000 + 15 * 60_000),
    )
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it.each([
    ['purged reply', null],
    [
      'cancelled publication',
      {
        ...approvedReply,
        status: 'draft',
        publicationState: 'cancelled',
      },
    ],
    ['newer publication cycle', { ...approvedReply, publicationCycle: 2 }],
  ])('post-call race guard: %s prevents acknowledgement', async (_case, current) => {
    const deps = makeDeps()
    deps.replyRepo.findById
      .mockResolvedValueOnce(approvedReply) // initial read
      .mockResolvedValueOnce(approvedReply) // reload after the read of Google
      .mockResolvedValueOnce(current)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledTimes(1)
    expect(
      deps.replyCommandStore.markProviderOutcomePendingObservation,
    ).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
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
    // claim; the failed provider acknowledgement never committed).
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
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'unconfirmed',
      }),
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
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'not_sent',
      }),
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
    // An edit-and-republish of unknown outcome: the read still answers with
    // the reply it was written over. The authority is asked, and says it
    // decided nothing; the job must not take its answer for a settlement.
    [
      'the reply an edit was written over, still shown',
      {
        read: () => ({
          status: 'found',
          review: {
            reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
            replyText: 'The reply before the edit',
            replyUpdatedAt: NOW,
          },
        }),
        resolution: 'earlier_publication_live',
        reason: 'earlier_publication_live',
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
    // The executor refused to compile the body (no permit, no fetch). The row
    // must not stay `sending`: a second attempt would read Google once and park
    // the reply as "Needs a check".
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

  it('a provider failure on the readback fails the job with the review API message', async () => {
    const deps = makeDeps()
    const sending = {
      ...approvedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    deps.replyRepo.findById.mockResolvedValue(sending)
    deps.googleReviewApi.getReview.mockRejectedValue(
      Object.assign(new Error('GBP API getReview failed (answered; status 403)'), {
        _tag: 'GbpApiError',
        code: 'upstream_error',
        dispatch: 'answered',
        providerStatus: 403,
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).rejects.toMatchObject({
      _tag: 'GoogleReviewApiError',
      message: 'Google review API request failed (upstream_error; answered; status 403)',
    })
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
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'unconfirmed',
      }),
      NOW,
      new Date(attemptStartedAt.getTime() + 30 * 60_000),
    )
  })
})
