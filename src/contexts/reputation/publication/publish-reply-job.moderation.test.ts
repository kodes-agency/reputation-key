import { describe, it, expect } from 'vitest'
import { GOOGLE_REVIEW_PRIMARY_RESOURCE } from '#/shared/testing/google-provider-identifiers-v1'
import { createPublishReplyHandler } from './publish-reply-job.server'
import { NOW, approvedReply, makeDeps, makeJob } from './publish-reply-job.test-fixtures'

vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

// write is one of the two reads RepKey makes of its own attempt, so it writes
// the one content-free line the behaviour decision will be designed from, and
// decides nothing differently from a read that lacks the field.
describe('publish-reply job handler reading Google moderation', () => {
  const sendingReply = {
    ...approvedReply,
    publicationState: 'sending',
    publicationAttempts: 1,
  }

  const pendingRead = (
    overrides: Readonly<{ replyText?: string | null; replyUnreadable?: boolean }> = {},
  ) => ({
    status: 'found',
    review: {
      reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
      replyText: 'Thanks!',
      replyUpdatedAt: NOW,
      replyModeration: {
        state: 'pending',
        policyViolation: null,
        commentPresent: true,
        commentEmpty: false,
        updateTimePresent: true,
        updateTimeEmpty: false,
      },
      ...overrides,
    },
  })

  it('writes one read-back line with the state, what Google sent and the text match', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue(sendingReply)
    deps.googleReviewApi.getReview.mockResolvedValue(pendingRead())
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(1))

    const lines = deps.logger.info.mock.calls.filter(
      ([fields]) =>
        typeof fields === 'object' &&
        (fields as { event?: string }).event === 'reply_publication_readback',
    )
    expect(lines).toEqual([
      [
        {
          event: 'reply_publication_readback',
          source: 'publish_readback',
          publicationCycle: 1,
          attemptNumber: 1,
          moderationState: 'pending',
          commentPresent: true,
          commentEmpty: false,
          updateTimePresent: true,
          updateTimeEmpty: false,
          textMatchedAttempt: true,
        },
        expect.any(String),
      ],
    ])
  })

  it('carries the policy code of a rejected reply and never the reply text', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue(sendingReply)
    deps.googleReviewApi.getReview.mockResolvedValue({
      status: 'found',
      review: {
        reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
        replyText: null,
        replyUpdatedAt: null,
        replyModeration: {
          state: 'rejected',
          policyViolation: 'SPAM',
          commentPresent: false,
          commentEmpty: false,
          updateTimePresent: false,
          updateTimeEmpty: false,
        },
      },
    })
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(1))

    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reply_publication_readback',
        moderationState: 'rejected',
        policyViolation: 'SPAM',
        commentPresent: false,
        commentEmpty: false,
        textMatchedAttempt: false,
      }),
      expect.any(String),
    )
    expect(JSON.stringify(deps.logger.info.mock.calls)).not.toContain('Thanks!')
  })

  it('writes the line for a reply it cannot read before it records nothing', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue(sendingReply)
    deps.googleReviewApi.getReview.mockResolvedValue(
      pendingRead({ replyText: null, replyUnreadable: true }),
    )
    const handler = createPublishReplyHandler(deps as never)

    await handler(makeJob(1))

    expect(deps.googleReplyObservationStore.record).not.toHaveBeenCalled()
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reply_publication_readback',
        moderationState: 'pending',
        textMatchedAttempt: false,
      }),
      expect.any(String),
    )
  })

  it('writes no line when the read fails, since Google showed nothing', async () => {
    const deps = makeDeps()
    deps.replyRepo.findById.mockResolvedValue(sendingReply)
    deps.googleReviewApi.getReview.mockRejectedValue(new Error('readback unavailable'))
    const handler = createPublishReplyHandler(deps as never)

    await expect(handler(makeJob(1))).rejects.toThrow('readback unavailable')

    expect(JSON.stringify(deps.logger.info.mock.calls)).not.toContain(
      'reply_publication_readback',
    )
  })

  it.each(['pending', 'rejected', 'unspecified', 'approved'] as const)(
    'decides a %s read exactly as the same read without the field',
    async (state) => {
      const without = makeDeps()
      without.replyRepo.findById.mockResolvedValue(sendingReply)
      without.googleReviewApi.getReview.mockResolvedValue({
        status: 'found',
        review: {
          reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
          replyText: 'Thanks!',
          replyUpdatedAt: NOW,
        },
      })
      const withState = makeDeps()
      withState.replyRepo.findById.mockResolvedValue(sendingReply)
      withState.googleReviewApi.getReview.mockResolvedValue({
        status: 'found',
        review: {
          reviewName: GOOGLE_REVIEW_PRIMARY_RESOURCE,
          replyText: 'Thanks!',
          replyUpdatedAt: NOW,
          replyModeration: {
            state,
            policyViolation: state === 'rejected' ? 'SPAM' : null,
            commentPresent: true,
            commentEmpty: false,
            updateTimePresent: true,
            updateTimeEmpty: false,
          },
        },
      })

      await createPublishReplyHandler(without as never)(makeJob(1))
      await createPublishReplyHandler(withState as never)(makeJob(1))

      expect(withState.googleReplyObservationStore.record.mock.calls).toEqual(
        without.googleReplyObservationStore.record.mock.calls,
      )
      for (const name of [
        'markPublicationTerminal',
        'markPublicationAmbiguous',
        'deferUncertainSend',
        'markProviderOutcomePendingObservation',
      ] as const) {
        expect(withState.replyCommandStore[name].mock.calls).toEqual(
          without.replyCommandStore[name].mock.calls,
        )
      }
    },
  )
})
