// publish-reply job handler behavior.
// BQC-3.2: the BQC-0.4 in-handler capability stop control moved to the
// dispatch gate (src/shared/jobs/delayed-execution-gate.ts) — see
// gated-dispatch.test.ts and architecture/delayed-policy-delegation.test.ts.
// BQC-3.3: provider outcomes are classified via the reply-publication saga —
// terminal 4xx rejections mark publish_failed WITHOUT burning BullMQ retries,
// retryable failures rethrow for the configured attempts, and ambiguous
// outcomes (timeout/unknown after the request may have landed) only mark
// publish_failed on the final attempt, with a reconciliation hint.

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
const JOB_DATA = { replyId: 'reply-1', organizationId: 'org-1' }

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
  submittedAt: NOW,
  approvedAt: NOW,
  publishedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
}

const review = {
  id: 'rev-1',
  organizationId: 'org-1',
  propertyId: 'prop-1',
  googleConnectionId: 'conn-1',
  externalLocationId: 'accounts/111/locations/222',
  externalId: 'ext-1',
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

function abortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

function makeDeps() {
  const replyCommandStore = {
    submitReply: vi.fn(),
    approveReply: vi.fn(),
    rejectReply: vi.fn(),
    markPublished: vi.fn(async (reply: object, updates: object, _event: object) => ({
      ...reply,
      ...updates,
    })),
    markPublishFailed: vi.fn(async (reply: object, updates: object, _event: object) => ({
      ...reply,
      ...updates,
    })),
    mirrorSyncedReply: vi.fn(),
    purgeExpiredReview: vi.fn(),
  }
  return {
    replyRepo: { findById: vi.fn().mockResolvedValue(approvedReply) },
    reviewRepo: { findById: vi.fn().mockResolvedValue(review) },
    googleReviewApi: { replyToReview: vi.fn().mockResolvedValue(undefined) },
    replyCommandStore,
    clock: () => NOW,
    idGen: () => 'reply-1',
    staffPublicApi: {},
  }
}

const makeJob = (attemptsMade = 0) =>
  ({ id: 'job-1', data: JOB_DATA, attemptsMade }) as never

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

  it('success → marks published via the command store with the durable fact', async () => {
    const deps = makeDeps()
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).toHaveBeenCalledWith(
      'org-1',
      'conn-1',
      'accounts/111/locations/222/reviews/ext-1',
      'Thanks!',
    )
    expect(deps.replyCommandStore.markPublished).toHaveBeenCalledTimes(1)
    const event = deps.replyCommandStore.markPublished.mock.calls[0]![2] as {
      _tag: string
    }
    expect(event._tag).toBe('review.reply.published')
    expect(deps.replyCommandStore.markPublishFailed).not.toHaveBeenCalled()
  })

  it('skips replies that are not in approved status', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue({ ...approvedReply, status: 'draft' })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob())

    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublishFailed).not.toHaveBeenCalled()
  })

  it('terminal provider rejection (4xx) → publish_failed WITHOUT burning retries (no rethrow)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpApiError(403))
    const handler = createPublishReplyHandler(deps as never)

    // First attempt, and the handler must NOT rethrow — remaining BullMQ
    // attempts must not be burned on a permanent rejection.
    await expect(handler(makeJob(0))).resolves.toBeUndefined()

    expect(deps.replyCommandStore.markPublishFailed).toHaveBeenCalledTimes(1)
    const event = deps.replyCommandStore.markPublishFailed.mock.calls[0]![2] as {
      _tag: string
    }
    expect(event._tag).toBe('review.reply.publish_failed')
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('429 rate limit → rethrows for BullMQ retry; marks failed only on the final attempt', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpRateLimited())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).not.toHaveBeenCalled()

    await expect(handler(makeJob(2))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).toHaveBeenCalledTimes(1)
  })

  it('5xx provider error → rethrows for BullMQ retry; marks failed on the final attempt', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(gbpApiError(500))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).not.toHaveBeenCalled()

    await expect(handler(makeJob(2))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).toHaveBeenCalledTimes(1)
  })

  it('network TypeError → retryable (rethrows; no markFailed before the final attempt)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(new TypeError('fetch failed'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).not.toHaveBeenCalled()
  })

  it('ambiguous timeout → rethrows before the final attempt', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(abortError())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).not.toHaveBeenCalled()
  })

  it('ambiguous timeout on the FINAL attempt → publish_failed (honest unknown)', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(abortError())
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(2))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).toHaveBeenCalledTimes(1)
    expect(deps.replyCommandStore.markPublished).not.toHaveBeenCalled()
  })

  it('unknown error → treated as ambiguous; final attempt marks publish_failed', async () => {
    const deps = makeDeps()
    deps.googleReviewApi.replyToReview.mockRejectedValue(new Error('socket hangup'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(0))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).not.toHaveBeenCalled()

    await expect(handler(makeJob(2))).rejects.toThrow()
    expect(deps.replyCommandStore.markPublishFailed).toHaveBeenCalledTimes(1)
  })

  it('missing Google connection → publish_failed (terminal, no rethrow)', async () => {
    const deps = makeDeps()
    deps.reviewRepo.findById.mockResolvedValue({ ...review, googleConnectionId: null })
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob())).resolves.toBeUndefined()
    expect(deps.googleReviewApi.replyToReview).not.toHaveBeenCalled()
    expect(deps.replyCommandStore.markPublishFailed).toHaveBeenCalledTimes(1)
  })
})
