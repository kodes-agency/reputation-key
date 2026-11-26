// Reply lifecycle use case tests

import { describe, it, expect, vi } from 'vitest'
import {
  draftReply,
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  retryPublish,
  editPublishedReply,
} from './reply-operations.server'
import type { ReviewRepository } from '../reviews/review-repository.port.server'
import type { Reply } from '../domain/review-types'
import { isReviewError } from '../domain/review-errors'
import type { ReplyDispatchEvidence } from '../publication/reply-publication-dispatch-evidence.port.server'
import {
  ORG_ID,
  REVIEW_ID,
  REPLY_ID,
  USER_ID,
  ADMIN_ID,
  PROP_ID,
  NOW,
  ATTEMPT_STARTED_AT,
  WONT_SEND_AGAIN,
  makeReview,
  makeReply,
  makeStaffApi,
  replyRepoWith,
  makeDeps,
  depsWith,
  MANAGER_CTX,
  ADMIN_CTX,
} from './reply-operations.test-fixtures'
import type { FakeGuardedWrite, TestReplyDeps } from './reply-operations.test-fixtures'

// ── retryPublish ────────────────────────────────────────────────────────

describe('retryPublish', () => {
  it('transitions publish_failed → approved, re-authorizes the publication cycle, and re-enqueues job', async () => {
    const failed = makeReply({ status: 'publish_failed', publicationState: 'terminal' })
    const deps = depsWith(failed)
    const result = await retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(result.publicationState).toBe('authorized')
    expect(result.publicationCycle).toBe(1)
    expect(deps.queue.addPublishJob).toHaveBeenCalledWith({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
      publicationCycle: 1,
      propertyId: PROP_ID,
      sourceEpoch: 0,
      materialReviewRevision: 1,
      baseObservationRevision: 0,
      initiator: { kind: 'user', id: USER_ID },
    })
  })

  it('treats provider-confirmed publication as an idempotent retry when reconciliation wins the race', async () => {
    const published = makeReply({ status: 'published', publicationState: 'published' })
    const deps = depsWith(published)

    await expect(retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)).resolves.toBe(
      published,
    )
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('fails closed when published status lacks settled publication state', async () => {
    const inconsistent = makeReply({
      status: 'published',
      publicationState: 'ambiguous',
      publicationCycle: 1,
      publicationAttempts: 1,
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: NOW,
    })
    const deps = depsWith(inconsistent, { findById: vi.fn(async () => inconsistent) })

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      _tag: 'ReviewError',
      message: WONT_SEND_AGAIN,
    })
    expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('rejects retry for an ineligible non-failed reply', async () => {
    const draft = makeReply({ status: 'draft', publicationState: null })
    const deps = depsWith(draft)

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  // Retry used to run the approval write for a reply still waiting for
  // approval: published with no approver and no review.reply.approved fact.
  it('refuses a reply that is still waiting for approval, authorizing nothing', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({ replyRepo: replyRepoWith(pending) })

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_transition',
      message: 'Only a reply that failed to publish can be sent again',
    })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('refuses to send a failed reply again while a template slot remains, reserving no cycle', async () => {
    const failed = makeReply({
      status: 'publish_failed',
      text: 'Dear {guest_name}, thank you.',
      approvedBy: ADMIN_ID,
      approvedAt: NOW,
      publicationState: 'terminal',
      publicationLastErrorClass: 'retryable',
      publicationCycle: 1,
      publicationAttempts: 1,
    })
    const deps = makeDeps({ replyRepo: replyRepoWith(failed) })

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({
      _tag: 'ReviewError',
      code: 'invalid_reply',
      message: 'Fill every template placeholder before publishing: {guest_name}.',
    })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('refuses a reply whose publication is still in flight', async () => {
    for (const publicationState of [
      'authorized',
      'sending',
      'pending_observation',
    ] as const) {
      const inFlight = makeReply({
        status: 'approved',
        publicationState,
        publicationCycle: 1,
      })
      const deps = makeDeps({ replyRepo: replyRepoWith(inFlight) })
      await expect(
        retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
      expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    }
  })

  // D4: an uncertain attempt may be sent again ONLY on positive evidence that
  // no request for it left RepKey. Retry never reads Google: absence on a read
  // is not that evidence, and checking is checkReplyPublication's job.
  const ambiguousAttempt = (overrides: Partial<Reply> = {}) =>
    makeReply({
      status: 'publish_failed',
      publicationState: 'ambiguous',
      publicationCycle: 1,
      publicationAttempts: 2,
      publicationLastErrorClass: 'ambiguous',
      reconcileDueAt: NOW,
      ...overrides,
    })

  const depsForUncertain = (reply: Reply, evidence: ReplyDispatchEvidence) => {
    const deps = depsWith(reply)
    vi.mocked(deps.dispatchEvidence.findDispatchEvidence).mockResolvedValue(evidence)
    return deps
  }

  it.each([
    ['a legacy ambiguous row', ambiguousAttempt()],
    [
      'terminal ambiguity',
      ambiguousAttempt({ publicationState: 'terminal', reconcileDueAt: null }),
    ],
  ])(
    'settles %s that never reached Google, then authorizes a new cycle and enqueues once',
    async (_name, reply) => {
      const deps = depsForUncertain(reply, 'never_dispatched')

      const result = await retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)

      expect(deps.dispatchEvidence.findDispatchEvidence).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        replyId: REPLY_ID,
        publicationCycle: 1,
        attemptNumber: 2,
        attemptStartedAt: ATTEMPT_STARTED_AT,
        now: NOW,
      })
      expect(deps.commandStore.settleNeverDispatchedAttempt).toHaveBeenCalledWith(
        reply,
        expect.objectContaining({
          _tag: 'review.reply.publish_failed',
          replyId: REPLY_ID,
        }),
        NOW,
      )
      expect(result).toMatchObject({
        status: 'approved',
        publicationState: 'authorized',
        publicationCycle: 2,
      })
      expect(deps.queue.addPublishJob).toHaveBeenCalledOnce()
      expect(deps.queue.addPublishJob).toHaveBeenCalledWith(
        expect.objectContaining({ replyId: REPLY_ID, publicationCycle: 2 }),
      )
      // Already publish_failed: no second failure fact, one publication intent.
      expect(deps.outbox.facts.map((fact) => fact._tag)).toEqual([
        'review.reply.publication_requested',
      ])
    },
  )

  it.each<ReplyDispatchEvidence>(['possibly_dispatched', 'too_recent'])(
    'refuses to send an ambiguous reply again when the evidence is %s',
    async (evidence) => {
      const deps = depsForUncertain(ambiguousAttempt(), evidence)

      await expect(
        retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({
        _tag: 'ReviewError',
        code: 'invalid_transition',
        message: WONT_SEND_AGAIN,
      })
      expect(deps.commandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
      expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
      expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
      expect(deps.outbox.facts).toHaveLength(0)
    },
  )

  it('refuses when no dated attempt row exists to judge', async () => {
    const deps = depsForUncertain(ambiguousAttempt(), 'never_dispatched')
    vi.mocked(deps.replyRepo.findCurrentPublicationAttemptStartedAt).mockResolvedValue(
      null,
    )

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: WONT_SEND_AGAIN })
    expect(deps.dispatchEvidence.findDispatchEvidence).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('returns the published reply when a confirmation wins the settle race', async () => {
    const reply = ambiguousAttempt()
    const published = {
      ...reply,
      status: 'published' as const,
      publicationState: 'published' as const,
    }
    const deps = depsForUncertain(reply, 'never_dispatched')
    vi.mocked(deps.replyRepo.conditionalUpdate).mockResolvedValue(null)
    vi.mocked(deps.replyRepo.findById).mockResolvedValue(published)

    await expect(retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)).resolves.toBe(
      published,
    )
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('refuses when the settle race is lost to anything but a confirmation', async () => {
    const reply = ambiguousAttempt()
    const deps = depsForUncertain(reply, 'never_dispatched')
    vi.mocked(deps.replyRepo.conditionalUpdate).mockResolvedValue(null)
    vi.mocked(deps.replyRepo.findById).mockResolvedValue(reply)

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: WONT_SEND_AGAIN })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })
})

// ── TOCTOU guard — conditionalUpdate atomicity ─────────────────────────
// Every transition use case commits through a guarded store write, so that a
// concurrent status change invalidates the write. A null return = lost race →
// invalid_transition, and no fact/job side-effects must fire.

describe('reply ops — TOCTOU guard (conditionalUpdate returns null → invalid_transition)', () => {
  const nullConditional = vi.fn(async () => null) as unknown as FakeGuardedWrite

  it('approveReply: lost race throws invalid_transition, no job enqueued or fact', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = depsWith(pending, { conditionalUpdate: nullConditional })
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('rejectReply: lost race throws invalid_transition, no fact', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = depsWith(pending, { conditionalUpdate: nullConditional })
    await expect(
      rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('retryPublish: lost race throws invalid_transition, no job enqueued', async () => {
    const failed = makeReply({ status: 'publish_failed', publicationState: 'terminal' })
    const deps = depsWith(failed, { conditionalUpdate: nullConditional })
    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('submitReply: lost race throws invalid_transition, no fact', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = depsWith(draft, { conditionalUpdate: nullConditional })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.outbox.facts).toHaveLength(0)
  })
})

// ── property-assignment scoping (D6-001) ─────────────────────────────────
// A PropertyManager may only mutate replies on reviews whose property they
// are assigned to. AccountAdmin (staffApi → null) bypasses the check.

describe('reply ops — property-assignment scoping (D6-001)', () => {
  const expectForbidden = (e: unknown) =>
    isReviewError(e) && (e as { code: string }).code === 'forbidden'

  it('draftReply rejects PM without assignment and does not persist', async () => {
    const deps = makeDeps({ staffPublicApi: makeStaffApi([]) })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Hi' }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
  })

  it('draftReply allows PM assigned to the property', async () => {
    const deps = makeDeps({ staffPublicApi: makeStaffApi([PROP_ID]) })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Hi' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
  })

  it('submitReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    await expect(
      submitReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    const result = await submitReply(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('pending_approval')
  })

  it('approveReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    await expect(
      approveReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    const result = await approveReply(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
  })

  it('rejectReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    await expect(
      rejectReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
    })
    const result = await rejectReply(assigned)(
      { reviewId: REVIEW_ID, reason: 'Tone' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('rejected')
  })

  it('deleteReply rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    await expect(
      deleteReply(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    })
    await deleteReply(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(assigned.replyRepo.deleteDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: REPLY_ID, organizationId: ORG_ID }),
    )
  })

  it('retryPublish rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(
        makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
      ),
    })
    await expect(
      retryPublish(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(
        makeReply({ status: 'publish_failed', publicationState: 'terminal' }),
      ),
    })
    const result = await retryPublish(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(assigned.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })

  it('AccountAdmin bypasses the assignment check (staffApi → null)', async () => {
    const deps = depsWith(makeReply({ status: 'draft' })) // default staffApi returns null = org-wide access
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, ADMIN_CTX)
    expect(result.status).toBe('pending_approval')
  })
})

// ── Google's reply comment rule (bytes, not characters) ────────────────

describe('reply ops — refuse text Google cannot be sent', () => {
  // 2049 Cyrillic letters are 2049 UTF-16 units but 4098 UTF-8 bytes: under
  // the old character cap they were approved and then failed compile in the
  // worker, where nobody saw why (route-catalogue.ts reviews.reply body).
  const TOO_LONG_CYRILLIC = 'Б'.repeat(2_049)
  const TOO_LONG =
    'This reply is too long for Google. Shorten it to 4,096 bytes or fewer.'
  const BAD_CHARACTER =
    "This reply contains a character Google doesn't accept. Remove any unusual control characters and try again."
  const MULTI_LINE = 'Hi Jane,\n\nThank you for staying with us.\tSee you soon!\r\n'

  it('draftReply refuses 2049 Cyrillic letters before any read or write', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: TOO_LONG_CYRILLIC }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.reviewRepo.findById).not.toHaveBeenCalled()
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
  })

  it('draftReply refuses a control character and a lone surrogate', async () => {
    const deps = makeDeps()
    for (const text of ['Thanks\u001B', 'Thanks \uD83D']) {
      await expect(
        draftReply(deps)({ reviewId: REVIEW_ID, text }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_reply', message: BAD_CHARACTER })
    }
    expect(deps.replyRepo.createDraft).not.toHaveBeenCalled()
  })

  it('draftReply saves 2048 Cyrillic letters and multi-line text', async () => {
    const deps = makeDeps()
    for (const text of ['Б'.repeat(2_048), MULTI_LINE]) {
      const saved = await draftReply(deps)({ reviewId: REVIEW_ID, text }, MANAGER_CTX)
      expect(saved.text).toBe(text)
    }
  })

  it('submitReply refuses a stored draft Google cannot take, with no transition', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'draft', text: TOO_LONG_CYRILLIC })),
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('approveReply refuses a stored reply Google cannot take, reserving no publication', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({ status: 'pending_approval', text: TOO_LONG_CYRILLIC }),
      ),
    })
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
  })

  it('submitReply and approveReply accept multi-line text', async () => {
    const draftDeps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'draft', text: MULTI_LINE })),
    })
    const submitted = await submitReply(draftDeps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(submitted.status).toBe('pending_approval')

    const pendingDeps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({ status: 'pending_approval', text: MULTI_LINE }),
      ),
    })
    const approved = await approveReply(pendingDeps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(approved.status).toBe('approved')
    expect(pendingDeps.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })

  it('editPublishedReply refuses 2049 Cyrillic letters before reply or provider work', async () => {
    const deps = makeDeps()
    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: TOO_LONG_CYRILLIC },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_reply', message: TOO_LONG })
    expect(deps.replyRepo.findInternalByReviewId).not.toHaveBeenCalled()
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('editPublishedReply republishes multi-line text', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({
          status: 'published',
          text: 'Old public reply',
          publicationState: 'published',
          publicationAttempts: 1,
          publishedAt: NOW,
        }),
      ),
    })
    const result = await editPublishedReply(deps)(
      { reviewId: REVIEW_ID, text: 'Hi Jane,\n\nThank you.' },
      MANAGER_CTX,
    )
    expect(result.text).toBe('Hi Jane,\n\nThank you.')
    expect(deps.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })
})

// ── Property publication scope ─────────────────────────────────────────
//
// Google is asked to publish only for an active Property at the source epoch
// the Review was observed at; the provider authorizer refuses anything else,
// and the worker reports that refusal as "Google rejected the reply". The
// commands refuse up front, in words, and reserve no publication cycle.

describe('Property publication scope', () => {
  const REMOVED =
    "This property has been removed, so RepKey won't send its replies to Google. Restore it from the Removed list to publish this reply."
  const NOT_RECHECKED =
    "RepKey hasn't checked this review on Google since its property was restored or reconnected. Try again after the next sync."

  const CLOSING =
    "Your organization is being closed, so RepKey won't send replies to Google."
  const DELETING =
    "This property is being deleted, so RepKey won't send its replies to Google."

  const archived = {
    getPublicationScope: vi.fn(async () => ({
      lifecycleState: 'archived' as const,
      sourceEpoch: 1,
    })),
  }
  const restored = {
    getPublicationScope: vi.fn(async () => ({
      lifecycleState: 'active' as const,
      sourceEpoch: 2,
    })),
  }

  const expectNoPublicationCycle = (deps: TestReplyDeps) => {
    expect(deps.replyRepo.conditionalUpdate).not.toHaveBeenCalled()
    expect(deps.outbox.facts).toHaveLength(0)
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  }

  it('refuses to approve a reply for a removed Property and reserves no cycle', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
      propertyPublicationScope: archived,
    })

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: REMOVED })
    expect(archived.getPublicationScope).toHaveBeenCalledWith(ORG_ID, PROP_ID)
    expectNoPublicationCycle(deps)
  })

  // Only an archived Property is on the Removed list; the other states say
  // what is actually happening to it, with no remedy the manager lacks.
  it.each([
    ['suspended while its Organization closes', { lifecycleState: 'suspended' }, CLOSING],
    ['disconnecting', { lifecycleState: 'disconnecting' }, DELETING],
    ['waiting to be purged', { lifecycleState: 'purge_pending' }, DELETING],
    ['being purged', { lifecycleState: 'purging' }, DELETING],
    ['purged', { lifecycleState: 'purged' }, DELETING],
    ['no longer present', null, DELETING],
  ] as const)(
    'refuses to approve for a Property %s, in its own words',
    async (_label, state, message) => {
      const deps = makeDeps({
        replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
        propertyPublicationScope: {
          getPublicationScope: vi.fn(async () =>
            state === null ? null : { ...state, sourceEpoch: 0 },
          ),
        },
      })

      await expect(
        approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
      ).rejects.toMatchObject({ code: 'invalid_transition', message })
      expectNoPublicationCycle(deps)
    },
  )

  it('refuses to approve until the Review is observed at the restored Property epoch', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'pending_approval' })),
      reviewRepo: {
        findById: vi.fn(async () => makeReview({ sourceEpoch: 1 })),
      } as unknown as ReviewRepository,
      propertyPublicationScope: restored,
    })

    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: NOT_RECHECKED })
    expectNoPublicationCycle(deps)
  })

  it('refuses to republish an edited reply for a removed Property', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({
          status: 'published',
          text: 'Old public reply',
          publicationState: 'published',
          publicationAttempts: 1,
          publishedAt: NOW,
        }),
      ),
      propertyPublicationScope: archived,
    })

    await expect(
      editPublishedReply(deps)(
        { reviewId: REVIEW_ID, text: 'Improved public reply' },
        MANAGER_CTX,
      ),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: REMOVED })
    expectNoPublicationCycle(deps)
  })

  it('refuses a retry for a removed Property before settling any attempt', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(
        makeReply({
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationCycle: 1,
          publicationAttempts: 2,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: NOW,
        }),
      ),
      propertyPublicationScope: archived,
    })
    vi.mocked(deps.dispatchEvidence.findDispatchEvidence).mockResolvedValue(
      'never_dispatched',
    )

    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', message: REMOVED })
    expect(deps.commandStore.settleNeverDispatchedAttempt).not.toHaveBeenCalled()
    expectNoPublicationCycle(deps)
  })
})
