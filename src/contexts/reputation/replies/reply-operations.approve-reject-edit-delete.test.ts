// Reply lifecycle use case tests

import { describe, it, expect, vi } from 'vitest'
import {
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  retryPublish,
  editPublishedReply,
} from './reply-operations.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import type { Reply } from '../domain/review-types'
import { GOOGLE_REPLY_COMMENT_MAX_BYTES } from '#/shared/google-provider-control/reply-comment'
import {
  buildIdempotencyKey,
  PUBLICATION_RECOVERY_RECONCILE_DELAY_MS,
} from '../domain/reply-publication-workflow'
import { replyId } from '#/shared/domain/ids'
import {
  ORG_ID,
  REVIEW_ID,
  REPLY_ID,
  USER_ID,
  ADMIN_ID,
  PROP_ID,
  NOW,
  makeReview,
  makeReply,
  replyRepoWith,
  makeDeps,
  depsWith,
  MANAGER_CTX,
  MEMBER_CTX,
} from './reply-operations.test-fixtures'
import type { FakeGuardedWrite } from './reply-operations.test-fixtures'

// ── approveReply ────────────────────────────────────────────────────────

describe('approveReply', () => {
  it('commits one authorization intent before enqueue and produces neither for a member', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = depsWith(pending)
    vi.mocked(deps.queue.addPublishJob).mockImplementation(async () => {
      expect(deps.outbox.byTag('review.reply.publication_requested')).toHaveLength(1)
    })

    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

    expect(result).toMatchObject({
      status: 'approved',
      approvedBy: USER_ID,
      publicationCycle: 1,
    })
    const intents = deps.outbox.byTag('review.reply.publication_requested')
    expect(intents).toHaveLength(1)
    const intent = intents[0]!
    expect(intent).toMatchObject({
      replyId: REPLY_ID,
      reviewId: REVIEW_ID,
      organizationId: ORG_ID,
      propertyId: PROP_ID,
      userId: USER_ID,
      publicationCycle: 1,
    })
    expect(deps.queue.addPublishJob).toHaveBeenCalledOnce()
    expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: intent.replyId,
        organizationId: intent.organizationId,
        publicationCycle: intent.publicationCycle,
        propertyId: intent.propertyId,
        sourceEpoch: intent.sourceEpoch,
        materialReviewRevision: intent.materialReviewRevision,
        baseObservationRevision: intent.baseObservationRevision,
        initiator: { kind: 'user', id: USER_ID },
      },
      { idempotencyKey: buildIdempotencyKey(intent.replyId, intent.publicationCycle) },
    )

    const memberDeps = depsWith(pending)
    await expect(
      approveReply(memberDeps)({ reviewId: REVIEW_ID }, MEMBER_CTX),
    ).rejects.toMatchObject({ code: 'unauthorized', _tag: 'ReviewError' })
    expect(memberDeps.outbox.byTag('review.reply.publication_requested')).toHaveLength(0)
    expect(memberDeps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('sets approvedAt when approving', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = depsWith(pending)
    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.approvedAt).toBe(NOW)
  })

  it('rejects approve from draft status', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = depsWith(draft)
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  // Approval is the move out of pending_approval. A failed reply is sent again
  // by retryPublish, which first proves an uncertain attempt never left RepKey.
  it.each([
    ['may already be on Google', { publicationState: 'ambiguous' as const }],
    [
      'ended its checks without an answer',
      {
        publicationState: 'terminal' as const,
        publicationLastErrorClass: 'ambiguous' as const,
      },
    ],
    [
      'failed and was not sent',
      {
        publicationState: 'terminal' as const,
        publicationLastErrorClass: 'retryable' as const,
      },
    ],
  ])('refuses to approve a failed reply that %s', async (_name, publication) => {
    const failed = makeReply({
      status: 'publish_failed',
      approvedBy: ADMIN_ID,
      approvedAt: NOW,
      publicationCycle: 1,
      publicationAttempts: 1,
      ...publication,
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(failed) })

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_transition',
      message: 'Only a reply that is waiting for approval can be confirmed and published',
    })
    expect(deps.propertyPublicationScope.getPublicationScope).not.toHaveBeenCalled()
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('refuses a reply that is no longer the one the manager’s screen showed', async () => {
    // Rejected, rewritten and submitted again while the confirmation was open:
    // pending in the same cycle, at a later state revision.
    const pending = makeReply({ status: 'pending_approval', stateRevision: 6 })
    const deps = makeDeps({ replyRepo: replyRepoWith(pending) })

    await expect(
      approveReply(deps)(
        { reviewId: REVIEW_ID, expectedReply: { id: REPLY_ID, stateRevision: 3 } },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_transition',
      message: 'Reply status changed concurrently',
    })
    expect(deps.propertyPublicationScope.getPublicationScope).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('refuses another reply that stands at the same state revision as the one the screen showed', async () => {
    // The reply on the screen was rejected and deleted, and a new one was
    // written and submitted: another row, whose revision counter started again
    // and stands where the first one stood.
    const replacement = makeReply({
      id: replyId('51000000-0000-4000-8000-000000000021'),
      status: 'pending_approval',
      stateRevision: 2,
      text: 'A reply nobody at this screen read',
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(replacement) })

    await expect(
      approveReply(deps)(
        { reviewId: REVIEW_ID, expectedReply: { id: REPLY_ID, stateRevision: 2 } },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_transition',
      message: 'Reply status changed concurrently',
    })
    expect(deps.propertyPublicationScope.getPublicationScope).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('confirms the reply the screen showed, at the state revision it showed', async () => {
    const pending = makeReply({ status: 'pending_approval', stateRevision: 6 })
    const deps = makeDeps({ replyRepo: replyRepoWith(pending) })

    await expect(
      approveReply(deps)(
        { reviewId: REVIEW_ID, expectedReply: { id: REPLY_ID, stateRevision: 6 } },
        MANAGER_CTX,
      ),
    ).resolves.toMatchObject({ status: 'approved', approvedBy: USER_ID })
    expect(deps.outbox.byTag('review.reply.approved')).toHaveLength(1)
    expect(deps.queue.addPublishJob).toHaveBeenCalledOnce()
  })

  it.each([
    ['submit', submitReply, 'draft', 'Edit it, then submit it again.'],
    [
      'Confirm & Publish',
      approveReply,
      'pending_approval',
      'Reject it so it can be edited and submitted again.',
    ],
  ] as const)(
    '%s refuses a stale AI draft and says what to do next',
    async (_name, command, status, nextStep) => {
      const aiReply = makeReply({ status, aiGenerated: true })
      const deps = makeDeps({
        replyRepo: replyRepoWith(aiReply),
        aiSuggestedDraftStore: {
          accept: vi.fn(),
          assertCurrentBinding: vi.fn(async () => 'stale' as const),
        },
      })

      await expect(
        command(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'ai_suggestion_stale',
        message: expect.stringContaining(nextStep),
      })
      expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    },
  )

  it.each([
    ['reject', rejectReply, makeReply({ status: 'pending_approval', aiGenerated: true })],
    [
      'Try publishing again',
      retryPublish,
      makeReply({
        status: 'publish_failed',
        aiGenerated: true,
        approvedBy: ADMIN_ID,
        approvedAt: NOW,
        publicationState: 'terminal',
        publicationLastErrorClass: 'terminal_rejection',
        publicationCycle: 1,
        publicationAttempts: 1,
      }),
    ],
    [
      'edit-and-republish',
      editPublishedReply,
      makeReply({
        status: 'published',
        aiGenerated: true,
        approvedBy: ADMIN_ID,
        approvedAt: NOW,
        publicationState: 'published',
        publicationCycle: 1,
        publicationAttempts: 1,
      }),
    ],
  ] as const)(
    '%s never asks whether an AI-assisted reply is still current',
    async (_name, command, aiReply) => {
      const assertCurrentBinding = vi.fn(async () => 'stale' as const)
      const deps = makeDeps({
        replyRepo: replyRepoWith(aiReply),
        aiSuggestedDraftStore: { accept: vi.fn(), assertCurrentBinding },
      })

      const result = await command(deps)(
        { reviewId: REVIEW_ID, text: 'Edited by a manager' },
        MANAGER_CTX,
      )

      expect(result.id).toBe(aiReply.id)
      expect(assertCurrentBinding).not.toHaveBeenCalled()
    },
  )

  it('refuses to approve a reply that is already being published or is published', async () => {
    for (const reply of [
      makeReply({ status: 'approved', publicationState: 'sending', publicationCycle: 1 }),
      makeReply({ status: 'published', publicationState: 'published' }),
      makeReply({ status: 'rejected' }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
      expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  it('approves a resubmitted reply whose earlier publication was cancelled', async () => {
    const resubmitted = makeReply({
      status: 'pending_approval',
      publicationState: 'cancelled',
      publicationCycle: 1,
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(resubmitted) })

    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

    expect(result).toMatchObject({
      status: 'approved',
      publicationState: 'authorized',
      publicationCycle: 2,
      approvedBy: USER_ID,
    })
    expect(deps.outbox.byTag('review.reply.approved')).toHaveLength(1)
  })

  it('refuses approval while a template slot remains without reserving publication work', async () => {
    const pending = makeReply({
      status: 'pending_approval',
      text: 'Dear {guest_name}, thank you.',
    })
    const deps = depsWith(pending)

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_reply',
      message: 'Fill every template placeholder before publishing: {guest_name}.',
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('records the reviewReplyApproved fact with correct data', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: replyRepoWith(pending),
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.outbox.byTag('review.reply.approved')).toHaveLength(1)
    const fact = deps.outbox.byTag('review.reply.approved')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)
    expect(fact.occurredAt).toBe(NOW)
  })
})

// ── editPublishedReply ─────────────────────────────────────────────────

describe('editPublishedReply', () => {
  const published = () =>
    makeReply({
      status: 'published',
      text: 'Old public reply',
      publicationState: 'published',
      publicationAttempts: 1,
      publishedAt: NOW,
    })

  it.each([
    ['Visit https://example.com for details.', 'url'],
    ['Book now for a free night.', 'offer_or_solicitation'],
    ['We will sue you.', 'threat'],
  ])('refuses unsafe edited text before republishing: %s', async (text, findingCode) => {
    const deps = makeDeps({ replyRepo: replyRepoWith(published()) })

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text }, MANAGER_CTX),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_reply',
      message: 'Reply failed required safety checks',
      context: { findingCodes: expect.arrayContaining([findingCode]) },
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('edits text, re-enters the publication machine, records review.reply.updated, and enqueues the republish', async () => {
    const reply = published()
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: replyRepoWith(reply),
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })

    const result = await editPublishedReply(deps)(
      { reviewId: REVIEW_ID, text: 'Improved public reply' },
      MANAGER_CTX,
    )

    expect(result.status).toBe('approved')
    expect(result.text).toBe('Improved public reply')
    expect(result.publicationState).toBe('authorized')
    expect(result.publicationCycle).toBe(1)
    expect(result.publicationAttempts).toBe(0)
    expect(result.publicationLastErrorClass).toBeNull()
    expect(result.reconcileDueAt).toEqual(
      new Date(NOW.getTime() + PUBLICATION_RECOVERY_RECONCILE_DELAY_MS),
    )

    const fact = deps.outbox.byTag('review.reply.updated')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)

    expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: REPLY_ID,
        organizationId: ORG_ID,
        publicationCycle: 1,
        propertyId: PROP_ID,
        sourceEpoch: 0,
        materialReviewRevision: 1,
        baseObservationRevision: 0,
        initiator: { kind: 'user', id: USER_ID },
      },
      { idempotencyKey: buildIdempotencyKey(REPLY_ID, 1) },
    )
  })

  it('no-ops when the trimmed text is unchanged (no write, no fact, no enqueue)', async () => {
    const reply = published()
    const deps = depsWith(reply)

    const result = await editPublishedReply(deps)(
      { reviewId: REVIEW_ID, text: '  Old public reply  ' },
      MANAGER_CTX,
    )

    expect(result).toBe(reply)
    expect(deps.outbox.facts).toHaveLength(0)
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('refuses an edit containing an unfilled slot before reply or provider work', async () => {
    const deps = makeDeps()

    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: 'Thank you, {staff_name}.' },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_reply',
      message: 'Fill every template placeholder before publishing: {staff_name}.',
    })
    expect(deps.replyRepo.findInternalByReviewId).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('rejects editing a non-published reply', async () => {
    const reply = makeReply({ status: 'approved', publicationState: 'authorized' })
    const deps = depsWith(reply)

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: 'New' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('rejects empty and over-length text', async () => {
    const reply = published()
    const deps = depsWith(reply)

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: '   ' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply' })
    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: 'x'.repeat(GOOGLE_REPLY_COMMENT_MAX_BYTES + 1) },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_reply' })
  })

  it('rejects when the reply does not exist', async () => {
    const deps = depsWith(null)

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: 'New' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'reply_not_found' })
  })

  it('treats a lost race (store returns null) as invalid_transition', async () => {
    const reply = published()
    const deps = depsWith(reply, {
      conditionalUpdate: vi.fn(async () => null) as unknown as FakeGuardedWrite,
    })

    await expect(
      editPublishedReply(deps)({ reviewId: REVIEW_ID, text: 'New text' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })
})

// ── rejectReply ─────────────────────────────────────────────────────────

describe('rejectReply', () => {
  it('transitions pending_approval → rejected with reason', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = depsWith(pending)
    const result = await rejectReply(deps)(
      { reviewId: REVIEW_ID, reason: 'Tone too aggressive' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('rejected')
    expect(result.rejectedBy).toBe(USER_ID)
    expect(result.rejectionReason).toBe('Tone too aggressive')
  })

  it('rejects without reason', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = depsWith(pending)
    const result = await rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.rejectionReason).toBeNull()
  })

  it('refuses a reply that is not waiting for approval', async () => {
    for (const reply of [
      makeReply({ status: 'draft' }),
      makeReply({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 1,
      }),
      makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
    ]) {
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await expect(
        rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        code: 'invalid_transition',
        _tag: 'ReviewError',
        message: 'Only a reply that is waiting for approval can be rejected',
      })
      expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  it('records the reviewReplyRejected fact with correct data', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: replyRepoWith(pending),
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await rejectReply(deps)(
      { reviewId: REVIEW_ID, reason: 'Tone too aggressive' },
      MANAGER_CTX,
    )
    expect(deps.outbox.byTag('review.reply.rejected')).toHaveLength(1)
    const fact = deps.outbox.byTag('review.reply.rejected')[0]!
    expect(fact.replyId).toBe(REPLY_ID)
    expect(fact.reviewId).toBe(REVIEW_ID)
    expect(fact.propertyId).toBe(PROP_ID)
    expect(fact.organizationId).toBe(ORG_ID)
    expect(fact.userId).toBe(USER_ID)
    expect(fact.reason).toBe('Tone too aggressive')
    expect(fact.occurredAt).toBe(NOW)
  })
})

// ── deleteReply ─────────────────────────────────────────────────────────

describe('deleteReply', () => {
  it.each(['draft', 'rejected'] as const)(
    'deletes a %s reply that was never confirmed',
    async (status) => {
      const reply = makeReply({ status })
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
      await deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
      expect(deps.replyRepo.deleteDraft).toHaveBeenCalledWith(reply)
    },
  )

  it('rejects deleting non-draft reply', async () => {
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const deps = makeDeps({ replyRepo: replyRepoWith(published) })
    await expect(
      deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Can only delete draft or rejected replies',
    })
    expect(deps.replyRepo.deleteDraft).not.toHaveBeenCalled()
  })

  // A cancelled publication returns the reply to draft, where Delete is
  // offered. Its authorization (and any attempt) rows reference it ON DELETE
  // RESTRICT: the delete used to reach the database and fail as a 500.
  it.each(['draft', 'rejected'] as const)(
    'refuses, in words, a %s reply that was confirmed for publishing before',
    async (status) => {
      const cancelled = makeReply({
        status,
        publicationState: 'cancelled',
        publicationCycle: 1,
      })
      const deps = makeDeps({ replyRepo: replyRepoWith(cancelled) })

      await expect(
        deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_transition',
        message:
          'This reply was confirmed for publishing before, so RepKey keeps it with its publication record. Edit it and submit it again, or leave it as a draft.',
      })
      expect(deps.replyRepo.deleteDraft).not.toHaveBeenCalled()
    },
  )

  it.each([null, { id: REPLY_ID, stateRevision: 1 }])(
    'refuses a delete from a screen that showed %j instead of the stored draft',
    async (expectedReply) => {
      const deps = depsWith(makeReply({ stateRevision: 2 }))
      await expect(
        deleteReply(deps)({ reviewId: REVIEW_ID, expectedReply }, MANAGER_CTX),
      ).rejects.toMatchObject({
        code: 'invalid_transition',
        message: 'Reply status changed concurrently',
      })
      expect(deps.replyRepo.deleteDraft).not.toHaveBeenCalled()
    },
  )

  it('deletes the draft the screen showed', async () => {
    const reply = makeReply({ stateRevision: 2 })
    const deps = makeDeps({ replyRepo: replyRepoWith(reply) })
    await deleteReply(deps)(
      { reviewId: REVIEW_ID, expectedReply: { id: reply.id, stateRevision: 2 } },
      MANAGER_CTX,
    )
    expect(deps.replyRepo.deleteDraft).toHaveBeenCalledWith(reply)
  })

  describe('a reply whose publication failed', () => {
    const failed = (overrides: Partial<Reply> = {}) =>
      makeReply({
        status: 'publish_failed',
        publicationState: 'terminal',
        publicationCycle: 1,
        publicationLastErrorClass: 'terminal_rejection',
        stateRevision: 3,
        ...overrides,
      })

    it('is cleared in its row, and the caller is told the revision to write against', async () => {
      const reply = failed()
      const restarted = { id: reply.id, stateRevision: 4 }
      const deps = makeDeps({
        replyRepo: {
          ...replyRepoWith(reply),
          deleteDraft: vi.fn(async () => restarted),
        },
      })

      await expect(
        deleteReply(deps)(
          { reviewId: REVIEW_ID, expectedReply: { id: reply.id, stateRevision: 3 } },
          MANAGER_CTX,
        ),
      ).resolves.toEqual(restarted)
      expect(deps.replyRepo.deleteDraft).toHaveBeenCalledWith(reply)
      // A later read could name a colleague's next draft, which this screen
      // has never seen and must not receive authority to overwrite.
      expect(deps.replyRepo.findInternalByReviewId).toHaveBeenCalledOnce()
    })

    it.each([
      ['an uncertain outcome that ended', { publicationLastErrorClass: 'ambiguous' }],
      [
        'an uncertain outcome still being checked',
        { publicationState: 'ambiguous', publicationLastErrorClass: 'ambiguous' },
      ],
    ] as const)('is refused for %s', async (_name, overrides) => {
      const deps = makeDeps({ replyRepo: replyRepoWith(failed(overrides)) })

      await expect(
        deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({ _tag: 'ReviewError', code: 'invalid_transition' })
      expect(deps.replyRepo.deleteDraft).not.toHaveBeenCalled()
    })

    it('is refused for a screen that showed another revision', async () => {
      const reply = failed()
      const deps = makeDeps({ replyRepo: replyRepoWith(reply) })

      await expect(
        deleteReply(deps)(
          { reviewId: REVIEW_ID, expectedReply: { id: reply.id, stateRevision: 2 } },
          MANAGER_CTX,
        ),
      ).rejects.toMatchObject({
        code: 'invalid_transition',
        message: 'Reply status changed concurrently',
      })
      expect(deps.replyRepo.deleteDraft).not.toHaveBeenCalled()
    })
  })

  it('treats a reply that changed before the delete as invalid_transition', async () => {
    const deps = depsWith(makeReply({ status: 'draft' }), {
      deleteDraft: vi.fn(async () => false),
    })
    await expect(
      deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: 'Reply status changed concurrently',
    })
  })
})
