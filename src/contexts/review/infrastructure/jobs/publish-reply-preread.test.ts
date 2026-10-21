// publish-reply: the read of Google that comes before the claim.
//
// `reviews.reply` is an upsert with no precondition, so before it claims a fresh
// publication the job reads the review from Google and records what it saw
// through the writer sync uses. A reply RepKey had not seen moves the head;
// the claim's head fence (and, for a cycle that has not sent yet, the
// observation store itself) then ends the cycle without a write.

import {
  GOOGLE_LOCATION_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_RESOURCE,
  GOOGLE_REVIEW_PRIMARY_SEGMENTS,
} from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { createGoogleReviewApiAdapter } from '#/contexts/integration/infrastructure/adapters/google-review-api.adapter'
import { readReviewBeforePublish } from '../../application/use-cases/read-review-before-publish'
import { createPublishReplyHandler } from './publish-reply.job'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

const NOW = new Date('2026-10-21T08:00:00Z')
const ORG = 'org-pre-read'
const IDS = {
  property: '00000000-0000-4000-8000-00000000c001',
  connection: '00000000-0000-4000-8000-00000000c002',
  review: '00000000-0000-4000-8000-00000000c003',
  reply: '00000000-0000-4000-8000-00000000c004',
}
const JOB_DATA = {
  replyId: IDS.reply,
  organizationId: ORG,
  publicationCycle: 2,
  propertyId: IDS.property,
  sourceEpoch: 4,
  materialReviewRevision: 3,
  baseObservationRevision: 5,
}

const authorizedReply = {
  id: IDS.reply,
  reviewId: IDS.review,
  organizationId: ORG,
  text: 'Thank you for staying with us.',
  status: 'approved',
  source: 'internal',
  createdBy: 'user-1',
  approvedBy: 'user-1',
  rejectedBy: null,
  rejectionReason: null,
  aiGenerated: false,
  templateId: null,
  templateVersion: null,
  stateRevision: 7,
  submittedAt: NOW,
  approvedAt: NOW,
  publishedAt: null,
  publicationState: 'authorized',
  publicationCycle: 2,
  publicationAttempts: 0,
  publicationLastErrorClass: null,
  reconcileDueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}
const review = {
  id: IDS.review,
  organizationId: ORG,
  propertyId: IDS.property,
  googleConnectionId: IDS.connection,
  externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
  externalId: GOOGLE_REVIEW_PRIMARY_SEGMENTS.reviewId,
  sourceEpoch: 4,
  sourceRevision: 3,
}

/** What the observation store leaves behind when it cancels a cycle that has
 * not sent: the Reply returns to draft, cancelled. */
const cancelledByStore = {
  ...authorizedReply,
  status: 'draft',
  publicationState: 'cancelled',
  stateRevision: 8,
}

/** The error the review adapter raises, as the publish classifier reads it. */
function reviewApiFailure(
  code: string,
  failure: Readonly<{
    executionCode: string | null
    dispatch: 'not_sent' | 'answered' | 'unknown'
    providerStatus: number | null
  }> | null = null,
): Error {
  return Object.assign(new Error(`Google review API request failed (${code})`), {
    _tag: 'GoogleReviewApiError',
    code,
    recoverable: code === 'provider_unavailable' || code === 'provider_rate_limited',
    ...(failure === null ? {} : { failure }),
  })
}

type HeadFence = Readonly<{
  observationRevision: number
  sourceEpoch: number
  materialReviewRevision: number
}>

function makeDeps(overrides: { replies?: object[] } = {}) {
  const replies = [...(overrides.replies ?? [])]
  const replyCommandStore = {
    markPublicationSending: vi.fn(async (reply: typeof authorizedReply) =>
      reply.publicationState === 'authorized'
        ? {
            ...reply,
            publicationState: 'sending',
            publicationAttempts: reply.publicationAttempts + 1,
          }
        : null,
    ),
    markProviderOutcomePendingObservation: vi.fn(async (reply: object) => ({
      ...reply,
      publicationState: 'pending_observation',
    })),
    markPublicationTerminal: vi.fn(
      async (reply: object, _errorClass: string, _event: object) => reply,
    ),
    markPublicationAmbiguous: vi.fn(async (reply: object) => reply),
    markPublicationRetryQueued: vi.fn(async (reply: object) => reply),
    cancelPublications: vi.fn(async () => 1),
  }
  return {
    replyRepo: {
      // The job's first read, then (after the pre-read) the reload.
      findById: vi.fn<() => Promise<object | null>>(
        async () => replies.shift() ?? authorizedReply,
      ),
      findCurrentPublicationAttemptStartedAt: vi.fn(async () => null),
    },
    reviewRepo: { findById: vi.fn<() => Promise<object>>(async () => review) },
    dispatchEvidence: { findDispatchEvidence: vi.fn(async () => 'too_recent') },
    googleReviewApi: {
      replyToReview: vi.fn(async () => ({ providerCorrelationId: 'google-1' })),
      getReview: vi.fn(),
    },
    googleReplyObservationStore: {
      allocateReadGeneration: vi.fn(async () => 1),
      record: vi.fn(),
      findCurrentHead: vi.fn<() => Promise<HeadFence | null>>(async () => ({
        observationRevision: 5,
        sourceEpoch: 4,
        materialReviewRevision: 3,
      })),
    },
    readBeforePublish: vi.fn(async () => ({ status: 'recorded' as const })),
    replyCommandStore,
    clock: () => NOW,
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    idGen: () => IDS.reply,
    staffPublicApi: {},
  }
}

const makeJob = (attemptsMade = 0, data = JOB_DATA) =>
  ({ id: 'job-1', data, attemptsMade }) as never

const reloadedAfterPreRead = (extra: object = {}) => ({
  ...authorizedReply,
  stateRevision: 9,
  ...extra,
})

describe('publish-reply reads Google before it claims', () => {
  it('reads the review, then claims and writes when Google shows what the manager saw', async () => {
    const deps = makeDeps({ replies: [authorizedReply, reloadedAfterPreRead()] })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(1))

    expect(deps.readBeforePublish).toHaveBeenCalledWith({
      organizationId: ORG,
      propertyId: IDS.property,
      connectionId: IDS.connection,
      sourceEpoch: 4,
      locationName: GOOGLE_LOCATION_PRIMARY_RESOURCE,
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      readKey: `${IDS.reply}:2:1`,
    })
    expect(deps.readBeforePublish.mock.invocationCallOrder[0]).toBeLessThan(
      deps.replyCommandStore.markPublicationSending.mock.invocationCallOrder[0]!,
    )
    expect(
      deps.replyCommandStore.markPublicationSending.mock.invocationCallOrder[0],
    ).toBeLessThan(deps.googleReviewApi.replyToReview.mock.invocationCallOrder[0]!)
    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledOnce()
    expect(deps.googleReviewApi.getReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
  })

  it('claims the Reply as the pre-read left it, not the copy it loaded first', async () => {
    const deps = makeDeps({ replies: [authorizedReply, reloadedAfterPreRead()] })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.markPublicationSending).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply, stateRevision: 9 }),
      expect.objectContaining({ baseObservationRevision: 5 }),
    )
  })

  it('writes an edit of its own live reply: the head Google shows is the head the manager authorized', async () => {
    const edit = { ...authorizedReply, text: 'Thank you, and see you again.' }
    const deps = makeDeps({ replies: [edit, { ...edit, stateRevision: 9 }] })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Thank you, and see you again.' }),
    )
  })

  it('does not read first for a publication that is already sending', async () => {
    const sending = {
      ...authorizedReply,
      publicationState: 'sending',
      publicationAttempts: 1,
    }
    const deps = makeDeps({ replies: [sending] })
    deps.googleReviewApi.getReview.mockResolvedValue({ status: 'not_found' })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(1))

    expect(deps.readBeforePublish).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('does not read for a Review that has no Google subject, and refuses as before', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.reviewRepo.findById.mockResolvedValue({ ...review, googleConnectionId: null })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.readBeforePublish).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ publicationState: 'sending' }),
      'terminal_rejection',
      expect.objectContaining({ outcome: 'refused' }),
    )
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })
})

describe('publish-reply when Google shows a reply RepKey had not seen', () => {
  it('stops without a claim or a write when the observation store ended the cycle', async () => {
    const deps = makeDeps({ replies: [authorizedReply, cancelledByStore] })
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
  })

  it('stops when the Reply was removed while it was read', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.replyRepo.findById
      .mockResolvedValueOnce(authorizedReply)
      .mockResolvedValueOnce(null)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('stops when a newer publication cycle took over while it was read', async () => {
    const deps = makeDeps({
      replies: [authorizedReply, reloadedAfterPreRead({ publicationCycle: 3 })],
    })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  describe('a cycle that had already been tried (requeued)', () => {
    const requeued = { ...authorizedReply, publicationAttempts: 1 }

    it('cancels it as provider truth when the head moved and the claim refused it', async () => {
      const deps = makeDeps({
        replies: [
          requeued,
          { ...requeued, stateRevision: 9 },
          { ...requeued, stateRevision: 9 },
        ],
      })
      deps.replyCommandStore.markPublicationSending.mockResolvedValue(null as never)
      deps.googleReplyObservationStore.findCurrentHead.mockResolvedValue({
        observationRevision: 6,
        sourceEpoch: 4,
        materialReviewRevision: 3,
      })
      const handler = createPublishReplyHandler(deps as never)

      await expect(handler(makeJob(1))).resolves.toBeUndefined()

      expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledWith([
        {
          reply: expect.objectContaining({
            id: IDS.reply,
            publicationState: 'authorized',
            publicationAttempts: 1,
          }),
          event: expect.objectContaining({
            _tag: 'review.reply.publication_cancelled',
            replyId: IDS.reply,
            reviewId: IDS.review,
            propertyId: IDS.property,
            organizationId: ORG,
            cause: 'provider_truth',
          }),
          now: NOW,
        },
      ])
      expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    })

    it('cancels it when Google now shows a reply on a review that had none', async () => {
      const deps = makeDeps({
        replies: [
          requeued,
          { ...requeued, stateRevision: 9 },
          { ...requeued, stateRevision: 9 },
        ],
      })
      deps.replyCommandStore.markPublicationSending.mockResolvedValue(null as never)
      deps.googleReplyObservationStore.findCurrentHead.mockResolvedValue(null)
      const handler = createPublishReplyHandler(deps as never)

      await handler(makeJob(1, { ...JOB_DATA, baseObservationRevision: 2 }))

      expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledOnce()
    })

    it('leaves a refused claim alone when the head is where the manager authorized it', async () => {
      const deps = makeDeps({
        replies: [
          requeued,
          { ...requeued, stateRevision: 9 },
          { ...requeued, stateRevision: 9 },
        ],
      })
      deps.replyCommandStore.markPublicationSending.mockResolvedValue(null as never)
      const handler = createPublishReplyHandler(deps as never)

      await handler(makeJob(1))

      expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    })

    it('cancels nothing when the cycle ended by the time the claim was refused', async () => {
      const deps = makeDeps({
        replies: [requeued, { ...requeued, stateRevision: 9 }, cancelledByStore],
      })
      deps.replyCommandStore.markPublicationSending.mockResolvedValue(null as never)
      deps.googleReplyObservationStore.findCurrentHead.mockResolvedValue({
        observationRevision: 6,
        sourceEpoch: 4,
        materialReviewRevision: 3,
      })
      const handler = createPublishReplyHandler(deps as never)

      await handler(makeJob(1))

      expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
    })
  })

  it('does not cancel a cycle that has not been tried when the claim is refused for another reason', async () => {
    const deps = makeDeps({
      replies: [authorizedReply, reloadedAfterPreRead(), reloadedAfterPreRead()],
    })
    deps.replyCommandStore.markPublicationSending.mockResolvedValue(null as never)
    deps.googleReplyObservationStore.findCurrentHead.mockResolvedValue({
      observationRevision: 6,
      sourceEpoch: 4,
      materialReviewRevision: 3,
    })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('cancels as provider truth, and never writes, over a reply it cannot read', async () => {
    const deps = makeDeps({ replies: [authorizedReply, reloadedAfterPreRead()] })
    deps.readBeforePublish.mockResolvedValue({ status: 'reply_unreadable' } as never)
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledWith([
      {
        reply: expect.objectContaining({ id: IDS.reply, stateRevision: 9 }),
        event: expect.objectContaining({ cause: 'provider_truth' }),
        now: NOW,
      },
    ])
    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('leaves an unreadable reply alone when recording the review already ended the cycle', async () => {
    const deps = makeDeps({ replies: [authorizedReply, cancelledByStore] })
    deps.readBeforePublish.mockResolvedValue({ status: 'reply_unreadable' } as never)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })
})

describe('publish-reply when the pre-read finds the review gone or the Property moved on', () => {
  it('ends the cycle as refused, like a 404 on the write, when Google no longer has the review', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockResolvedValue({ status: 'review_missing' } as never)
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply, publicationState: 'authorized' }),
      'terminal_rejection',
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'refused',
      }),
    )
    expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('cancels as policy when the Property moved on during the read', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockResolvedValue({ status: 'obsolete' } as never)
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledWith([
      expect.objectContaining({
        event: expect.objectContaining({ cause: 'policy' }),
      }),
    ])
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('cancels as policy when the authorizer says the Property is no longer active at that epoch', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockRejectedValue(
      reviewApiFailure('authorization_changed', {
        executionCode: 'stale_source',
        dispatch: 'not_sent',
        providerStatus: null,
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()

    expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledWith([
      expect.objectContaining({
        event: expect.objectContaining({ cause: 'policy' }),
      }),
    ])
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })
})

describe('publish-reply when the read of Google fails', () => {
  const transient = () =>
    reviewApiFailure('provider_unavailable', {
      executionCode: null,
      dispatch: 'answered',
      providerStatus: 503,
    })

  it.each([0, 1, 3])(
    'rethrows a transient failure on attempt %i for BullMQ to retry, with nothing claimed or marked',
    async (attemptsMade) => {
      const deps = makeDeps({ replies: [authorizedReply] })
      deps.readBeforePublish.mockRejectedValue(transient())
      const handler = createPublishReplyHandler(deps as never)

      await expect(handler(makeJob(attemptsMade))).rejects.toMatchObject({
        code: 'provider_unavailable',
      })

      expect(deps.replyCommandStore.markPublicationSending).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationRetryQueued).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
      expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
      expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    },
  )

  it('reads a failure with no dispatch evidence as retryable too: a read proves nothing was written', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockRejectedValue(new Error('socket hang up'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow('socket hang up')

    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
  })

  it('ends a cycle that could not be read on the last attempt as not sent, and still rethrows', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockRejectedValue(transient())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(4))).rejects.toMatchObject({
      code: 'provider_unavailable',
    })

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply, publicationState: 'authorized' }),
      'retryable',
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'not_sent',
      }),
    )
    expect(deps.replyCommandStore.markPublicationAmbiguous).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('ends a refusal terminally on the first attempt, without burning retries', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockRejectedValue(
      reviewApiFailure('authorization_changed', {
        executionCode: 'authorization_denied',
        dispatch: 'not_sent',
        providerStatus: null,
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply }),
      'terminal_rejection',
      expect.objectContaining({ outcome: 'refused' }),
    )
    expect(
      deps.replyCommandStore.markPublicationTerminal.mock.calls[0]?.[2],
    ).not.toHaveProperty('cause')
    expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
  })

  it('names the reconnect remedy when the connection waits for a reconnect', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockRejectedValue(
      reviewApiFailure('reauthorization_required', {
        executionCode: 'authorization_denied',
        dispatch: 'not_sent',
        providerStatus: null,
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply }),
      'terminal_rejection',
      expect.objectContaining({
        _tag: 'review.reply.publish_failed',
        outcome: 'refused',
        cause: 'google_reauthorization_required',
      }),
    )
  })

  it('treats an answered 4xx from Google as a refusal, not a retry', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockRejectedValue(
      reviewApiFailure('provider_rejected', {
        executionCode: null,
        dispatch: 'answered',
        providerStatus: 400,
      }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply }),
      'terminal_rejection',
      expect.objectContaining({ outcome: 'refused' }),
    )
  })

  it('logs the failure content-free', async () => {
    const deps = makeDeps({ replies: [authorizedReply] })
    deps.readBeforePublish.mockRejectedValue(transient())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toMatchObject({
      code: 'provider_unavailable',
    })

    expect(deps.logger.error).toHaveBeenCalledWith(
      {
        attempt: 1,
        failureClass: 'ambiguous',
        executionCode: null,
        dispatch: 'answered',
        providerStatus: 503,
        errorName: 'Error',
        errorCode: 'provider_unavailable',
      },
      expect.any(String),
    )
    expect(JSON.stringify(deps.logger.error.mock.calls)).not.toContain('Thank you')
  })
})

// The same job over the real review adapter and the real read use case: the
// review-sync authorizer's plain-Error refusals have to arrive at the job in the
// write path's vocabulary, or the author hears "safe to try again" for a Google
// connection that needs reconnecting.
describe('publish-reply read before the claim over the real review adapter', () => {
  const syncAuthorization = {
    capability: 'property.connect_gbp' as const,
    organizationId: ORG,
    propertyId: IDS.property,
    connectionId: IDS.connection,
    initiatorUserId: null,
    expectedCredentialGeneration: 3,
    authorizationVector: { generation: 3, propertySourceEpoch: 4 },
  }
  const usableConnection = {
    status: 'active',
    credentialUseState: 'active',
    credentialGeneration: 3,
  }
  const refusedWith = (code: string) =>
    vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error(`authorization is unavailable: ${code}`), { code }),
      )

  function realAdapterDeps(
    input: Readonly<{
      authorize?: Mock
      connection?: object
      answer?: object
    }>,
  ) {
    const deps = makeDeps({ replies: [authorizedReply] })
    const execute = vi.fn().mockResolvedValue(
      input.answer ?? {
        ok: true,
        status: 404,
        headers: {
          contentType: 'application/json',
          cacheControl: null,
          retryAfter: null,
        },
        body: new Uint8Array(),
      },
    )
    const api = createGoogleReviewApiAdapter({
      connectionRepo: {
        findById: vi.fn().mockResolvedValue(input.connection ?? usableConnection),
      } as never,
      logger: { warn: vi.fn() } as never,
      cursorStore: {} as never,
      executor: { execute },
      authorizeReviewSyncProviderCall:
        input.authorize ??
        vi.fn().mockResolvedValue({
          accessToken: 'ya29.access-token',
          authorization: syncAuthorization,
        }),
      nowMs: () => NOW.getTime(),
    })
    const readBeforePublish = readReviewBeforePublish({
      googleReviewApi: api,
      propertySourceEpoch: { getSourceEpoch: vi.fn(async () => ({ sourceEpoch: 4 })) },
      observationWriter: {
        allocateReplyReadGeneration: vi.fn(async () => 1),
        persist: vi.fn(),
      },
      subjectKeyService: {} as never,
    } as never)
    const handler = createPublishReplyHandler({ ...deps, readBeforePublish } as never)
    return { deps, handler, execute }
  }

  it('names the reconnect remedy for a connection that waits for a reconnect', async () => {
    const { deps, handler, execute } = realAdapterDeps({
      authorize: refusedWith('authorization_denied'),
      connection: { ...usableConnection, status: 'reauth_required' },
    })

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply }),
      'terminal_rejection',
      expect.objectContaining({
        outcome: 'refused',
        cause: 'google_reauthorization_required',
      }),
    )
    expect(execute).not.toHaveBeenCalled()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })

  it('retries an authorizer outage and marks nothing', async () => {
    const { deps, handler } = realAdapterDeps({
      authorize: refusedWith('runtime_unavailable'),
    })

    await expect(handler(makeJob(0))).rejects.toMatchObject({
      code: 'provider_unavailable',
    })

    expect(deps.replyCommandStore.markPublicationTerminal).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.cancelPublications).not.toHaveBeenCalled()
  })

  it('cancels as policy when the authorizer finds the Property moved on', async () => {
    const { deps, handler } = realAdapterDeps({ authorize: refusedWith('stale_source') })

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.cancelPublications).toHaveBeenCalledWith([
      expect.objectContaining({ event: expect.objectContaining({ cause: 'policy' }) }),
    ])
  })

  it('refuses the publication when Google answers 404 for the review', async () => {
    const { deps, handler, execute } = realAdapterDeps({})

    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ routeKey: 'reviews.get' }),
      expect.anything(),
    )
    expect(deps.replyCommandStore.markPublicationTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: IDS.reply }),
      'terminal_rejection',
      expect.objectContaining({ outcome: 'refused' }),
    )
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
  })
})
