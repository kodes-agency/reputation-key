// Review context — reply lifecycle use case tests

import { describe, it, expect, vi } from 'vitest'
import {
  draftReply,
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  getReply,
  retryPublish,
  markReplyPublished,
  markReplyPublishFailed,
} from './reply-operations'
import type { ReplyDeps } from './reply-operations'
import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { Reply, Review } from '../../domain/types'
import { isReviewError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'
import {
  reviewId,
  replyId,
  organizationId,
  userId as toUserId,
  propertyId,
} from '#/shared/domain/ids'
const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-isolated')
const REVIEW_ID = reviewId('rev-1')
const REPLY_ID = replyId('reply-1')
const USER_ID = toUserId('user-1')
const ADMIN_ID = toUserId('admin-1')
const PROP_ID = propertyId('prop-1')
const NOW = new Date('2025-06-01T12:00:00Z')

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW_ID,
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'loc-1',
    googleConnectionId: null,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great!',
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: NOW,
    sentimentLabel: null,
    sentimentScore: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: REPLY_ID,
    reviewId: REVIEW_ID,
    organizationId: ORG_ID,
    text: 'Thank you!',
    source: 'internal',
    status: 'draft',
    createdBy: USER_ID,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: null,
    approvedAt: null,
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const makeStaffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const replyRepoWith = (reply: Reply | null): ReplyRepository => ({
  ...makeDeps().replyRepo,
  findInternalByReviewId: vi.fn(async () => reply),
})

function makeDeps(overrides: Partial<ReplyDeps> = {}): ReplyDeps {
  return {
    replyRepo: {
      upsert: vi.fn(async (r: Reply) => r),
      // Default conditionalUpdate applies the delta onto a base reply and returns it,
      // mirroring the real atomic guard's success path. TOCTOU tests override this to
      // return null (lost race).
      conditionalUpdate: vi.fn(
        async (
          id: string,
          _org: unknown,
          _statuses: unknown,
          updates: Record<string, unknown>,
        ) => ({
          ...makeReply(),
          id,
          ...updates,
        }),
      ) as unknown as ReplyRepository['conditionalUpdate'],
      findById: vi.fn(async () => null),
      findInternalByReviewId: vi.fn(async () => null),
      deleteById: vi.fn(async () => {}),
    } as unknown as ReplyRepository,
    reviewRepo: {
      findById: vi.fn(async () => makeReview()),
    } as unknown as ReviewRepository,
    queue: {
      addPublishJob: vi.fn(async () => {}),
    } as unknown as ReplyQueuePort,
    events: {
      emit: vi.fn(async () => {}),
      on: vi.fn(),
    } as unknown as EventBus,
    clock: () => NOW,
    idGen: () => REPLY_ID,
    staffPublicApi: makeStaffApi(null),
    ...overrides,
  }
}

const MANAGER_CTX = {
  role: 'PropertyManager' as const,
  userId: USER_ID,
  organizationId: ORG_ID,
}
const ADMIN_CTX = {
  role: 'AccountAdmin' as const,
  userId: ADMIN_ID,
  organizationId: ORG_ID,
}
const STAFF_CTX = { role: 'Staff' as const, userId: USER_ID, organizationId: ORG_ID }

// ── draftReply ──────────────────────────────────────────────────────────

describe('draftReply', () => {
  it('creates a new draft reply', async () => {
    const deps = makeDeps()
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Thank you!' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
    expect(result.text).toBe('Thank you!')
    expect(result.source).toBe('internal')
    expect(result.aiGenerated).toBe(false)
    expect(deps.replyRepo.upsert).toHaveBeenCalledTimes(1)
  })

  it('updates existing draft', async () => {
    const existing = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => existing),
      } as unknown as ReplyRepository,
    })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Updated reply' },
      MANAGER_CTX,
    )
    expect(result.text).toBe('Updated reply')
    expect(result.status).toBe('draft')
  })

  it('allows re-drafting a rejected reply', async () => {
    const rejected = makeReply({ status: 'rejected', rejectionReason: 'Bad tone' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => rejected),
      } as unknown as ReplyRepository,
    })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Improved reply' },
      MANAGER_CTX,
    )
    expect(result.status).toBe('draft')
    expect(result.rejectionReason).toBeNull()
    expect(result.rejectedBy).toBeNull()
  })

  it('rejects empty text', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: '' }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('rejects text exceeding max length', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'x'.repeat(4097) }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Hi' }, STAFF_CTX),
    ).rejects.toThrow()
  })

  it('allows AccountAdmin role', async () => {
    const deps = makeDeps()
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Admin reply' },
      ADMIN_CTX,
    )
    expect(result.status).toBe('draft')
  })

  it('rejects edit on pending_approval reply', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('validates the re-draft transition via transitionReply (not an inline guard)', async () => {
    // A published reply cannot transition to draft — transitionReply must reject it.
    const published = makeReply({ status: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Edit' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('uses conditionalUpdate (not upsert) when editing an existing draft', async () => {
    const draft = makeReply({ status: 'draft' })
    const conditionalUpdate = vi.fn(async (id: string) => ({
      ...draft,
      id,
    })) as unknown as ReplyRepository['conditionalUpdate']
    const upsert = vi.fn(async (r: Reply) => r)
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        upsert,
        conditionalUpdate,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    const result = await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Edited text' },
      MANAGER_CTX,
    )
    expect(conditionalUpdate).toHaveBeenCalledWith(
      REPLY_ID,
      ORG_ID,
      ['draft'],
      expect.objectContaining({ status: 'draft', text: 'Edited text' }),
      NOW,
    )
    expect(upsert).not.toHaveBeenCalled()
    expect(result.status).toBe('draft')
  })

  it('uses conditionalUpdate for rejected → draft re-draft with correct expected status', async () => {
    const rejected = makeReply({ status: 'rejected', rejectionReason: 'Bad tone' })
    const conditionalUpdate = vi.fn(
      async (id: string, _o: unknown, _s: unknown, u: Record<string, unknown>) => ({
        ...rejected,
        id,
        ...u,
      }),
    ) as unknown as ReplyRepository['conditionalUpdate']
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        conditionalUpdate,
        findInternalByReviewId: vi.fn(async () => rejected),
      } as unknown as ReplyRepository,
    })
    await draftReply(deps)({ reviewId: REVIEW_ID, text: 'Improved' }, MANAGER_CTX)
    expect(conditionalUpdate).toHaveBeenCalledWith(
      REPLY_ID,
      ORG_ID,
      ['rejected'],
      expect.objectContaining({
        status: 'draft',
        text: 'Improved',
        rejectedBy: null,
        rejectionReason: null,
      }),
      NOW,
    )
  })

  it('treats a lost race on re-draft (conditionalUpdate returns null) as invalid_transition', async () => {
    const rejected = makeReply({ status: 'rejected' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => rejected),
        conditionalUpdate: vi.fn(
          async () => null,
        ) as unknown as ReplyRepository['conditionalUpdate'],
      } as unknown as ReplyRepository,
    })
    await expect(
      draftReply(deps)({ reviewId: REVIEW_ID, text: 'Try again' }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('tags new reply with the caller organizationId (never a leaked org)', async () => {
    const upsert = vi.fn(async (r: Reply) => r)
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        upsert,
      } as unknown as ReplyRepository,
    })

    await draftReply(deps)(
      { reviewId: REVIEW_ID, text: 'Tenant-scoped reply' },
      { ...MANAGER_CTX, organizationId: OTHER_ORG_ID },
    )

    expect(upsert).toHaveBeenCalledTimes(1)
    const createdReply = upsert.mock.calls[0]![0] as Reply
    expect(createdReply.organizationId).toBe(OTHER_ORG_ID)
  })
})

// ── submitReply ─────────────────────────────────────────────────────────

describe('submitReply', () => {
  it('transitions draft → pending_approval', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('pending_approval')
  })

  it('sets submittedAt when submitting', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.submittedAt).toBe(NOW)
  })

  it('rejects if no reply exists', async () => {
    const deps = makeDeps()
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('rejects submit from published status', async () => {
    const published = makeReply({ status: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('emits reviewReplySubmitted event with correct data', async () => {
    const draft = makeReply({ status: 'draft' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('review.reply.submitted')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)
    expect(emittedEvent.occurredAt).toBe(NOW)
  })

  it('treats a lost race (conditionalUpdate returns null) as invalid_transition', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
        conditionalUpdate: vi.fn(
          async () => null,
        ) as unknown as ReplyRepository['conditionalUpdate'],
      } as unknown as ReplyRepository,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
  })
})

// ── approveReply ────────────────────────────────────────────────────────

describe('approveReply', () => {
  it('transitions pending_approval → approved and enqueues publish job', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(result.approvedBy).toBe(USER_ID)
    expect(deps.queue.addPublishJob).toHaveBeenCalledWith({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
  })

  it('sets approvedAt when approving', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    const result = await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.approvedAt).toBe(NOW)
  })

  it('rejects approve from draft status', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })

  it('emits reviewReplyApproved event with correct data', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('review.reply.approved')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)
    expect(emittedEvent.occurredAt).toBe(NOW)
  })
})

// ── rejectReply ─────────────────────────────────────────────────────────

describe('rejectReply', () => {
  it('transitions pending_approval → rejected with reason', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
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
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
    })
    const result = await rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.rejectionReason).toBeNull()
  })

  it('emits reviewReplyRejected event with correct data', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await rejectReply(deps)(
      { reviewId: REVIEW_ID, reason: 'Tone too aggressive' },
      MANAGER_CTX,
    )
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('review.reply.rejected')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)
    expect(emittedEvent.reason).toBe('Tone too aggressive')
    expect(emittedEvent.occurredAt).toBe(NOW)
  })
})

// ── deleteReply ─────────────────────────────────────────────────────────

describe('deleteReply', () => {
  it('deletes a draft reply', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    await deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(deps.replyRepo.deleteById).toHaveBeenCalledWith(REPLY_ID, ORG_ID)
  })

  it('rejects deleting non-draft reply', async () => {
    const published = makeReply({ status: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      deleteReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })
})

// ── getReply ────────────────────────────────────────────────────────────

describe('getReply', () => {
  it('returns existing reply', async () => {
    const reply = makeReply()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => reply),
      } as unknown as ReplyRepository,
    })
    const result = await getReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result).toEqual(reply)
  })

  it('returns null when no reply exists', async () => {
    const deps = makeDeps()
    const result = await getReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result).toBeNull()
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(getReply(deps)({ reviewId: REVIEW_ID }, STAFF_CTX)).rejects.toThrow()
  })

  // ── Tenant isolation ──────────────────────────────────────────────
  it('passes the caller organizationId to the repo (never a leaked org)', async () => {
    const findInternalByReviewId = vi.fn(async () => null)
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId,
      } as unknown as ReplyRepository,
    })

    await getReply(deps)(
      { reviewId: REVIEW_ID },
      { ...MANAGER_CTX, organizationId: OTHER_ORG_ID },
    )

    expect(findInternalByReviewId).toHaveBeenCalledWith(REVIEW_ID, OTHER_ORG_ID)
  })
})

// ── markReplyPublished ──────────────────────────────────────────────────

describe('markReplyPublished', () => {
  it('transitions approved → published and emits event with correct propertyId', async () => {
    const approved = makeReply({ status: 'approved' })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    const result = await markReplyPublished(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
    expect(result.status).toBe('published')
    expect(result.publishedAt).toBe(NOW)
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent.propertyId).toBe(PROP_ID)
  })

  it('emits userId: null (system actor) — publish runs from the BullMQ job, not a user', async () => {
    const approved = makeReply({ status: 'approved', createdBy: USER_ID })
    const review = makeReview()
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => review),
      } as unknown as ReviewRepository,
    })
    await markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID })
    expect(vi.mocked(deps.events.emit).mock.calls[0][0]).toMatchObject({
      _tag: 'review.reply.published',
      userId: null,
      authorId: USER_ID,
    })
  })

  it('rejects if reply not in approved status', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => draft),
      } as unknown as ReplyRepository,
    })
    await expect(
      markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID }),
    ).rejects.toThrow()
  })

  it('rejects if review not found', async () => {
    const approved = makeReply({ status: 'approved' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
      } as unknown as ReplyRepository,
      reviewRepo: {
        findById: vi.fn(async () => null),
      } as unknown as ReviewRepository,
    })
    await expect(
      markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID }),
    ).rejects.toThrow()
  })
})

// ── markReplyPublishFailed ──────────────────────────────────────────────

describe('markReplyPublishFailed', () => {
  it('transitions approved → publish_failed', async () => {
    const approved = makeReply({ status: 'approved' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
      } as unknown as ReplyRepository,
    })
    const result = await markReplyPublishFailed(deps)({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
    expect(result.status).toBe('publish_failed')
  })
})

// ── retryPublish ────────────────────────────────────────────────────────

describe('retryPublish', () => {
  it('transitions publish_failed → approved and re-enqueues job', async () => {
    const failed = makeReply({ status: 'publish_failed' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => failed),
      } as unknown as ReplyRepository,
    })
    const result = await retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(deps.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })

  it('rejects retry for non-failed reply', async () => {
    const published = makeReply({ status: 'published' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => published),
      } as unknown as ReplyRepository,
    })
    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toThrow()
  })
})

// ── TOCTOU guard — conditionalUpdate atomicity ─────────────────────────
// Every transition use case must use conditionalUpdate (not upsert) so that a
// concurrent status change invalidates the write. A null return = lost race →
// invalid_transition, and no event/job side-effects must fire.

describe('reply ops — TOCTOU guard (conditionalUpdate returns null → invalid_transition)', () => {
  const nullConditional = vi.fn(
    async () => null,
  ) as unknown as ReplyRepository['conditionalUpdate']

  it('approveReply: lost race throws invalid_transition, no job enqueued, no event', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      approveReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('rejectReply: lost race throws invalid_transition, no event', async () => {
    const pending = makeReply({ status: 'pending_approval' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => pending),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      rejectReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('markReplyPublished: lost race throws invalid_transition, no event', async () => {
    const approved = makeReply({ status: 'approved' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      markReplyPublished(deps)({ replyId: REPLY_ID, organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
  })

  it('markReplyPublishFailed: lost race throws invalid_transition', async () => {
    const approved = makeReply({ status: 'approved' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findById: vi.fn(async () => approved),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      markReplyPublishFailed(deps)({ replyId: REPLY_ID, organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
  })

  it('retryPublish: lost race throws invalid_transition, no job enqueued', async () => {
    const failed = makeReply({ status: 'publish_failed' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => failed),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      retryPublish(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.queue.addPublishJob).not.toHaveBeenCalled()
  })

  it('submitReply: lost race throws invalid_transition, no event', async () => {
    const draft = makeReply({ status: 'draft' })
    const deps = makeDeps({
      replyRepo: {
        ...makeDeps().replyRepo,
        findInternalByReviewId: vi.fn(async () => draft),
        conditionalUpdate: nullConditional,
      } as unknown as ReplyRepository,
    })
    await expect(
      submitReply(deps)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toMatchObject({ code: 'invalid_transition', _tag: 'ReviewError' })
    expect(deps.events.emit).not.toHaveBeenCalled()
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
    expect(deps.replyRepo.upsert).not.toHaveBeenCalled()
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
    expect(assigned.replyRepo.deleteById).toHaveBeenCalledWith(REPLY_ID, ORG_ID)
  })

  it('retryPublish rejects PM without assignment, allows when assigned', async () => {
    const unassigned = makeDeps({
      staffPublicApi: makeStaffApi([]),
      replyRepo: replyRepoWith(makeReply({ status: 'publish_failed' })),
    })
    await expect(
      retryPublish(unassigned)({ reviewId: REVIEW_ID }, MANAGER_CTX),
    ).rejects.toSatisfy(expectForbidden)

    const assigned = makeDeps({
      staffPublicApi: makeStaffApi([PROP_ID]),
      replyRepo: replyRepoWith(makeReply({ status: 'publish_failed' })),
    })
    const result = await retryPublish(assigned)({ reviewId: REVIEW_ID }, MANAGER_CTX)
    expect(result.status).toBe('approved')
    expect(assigned.queue.addPublishJob).toHaveBeenCalledTimes(1)
  })

  it('AccountAdmin bypasses the assignment check (staffApi → null)', async () => {
    const deps = makeDeps({
      replyRepo: replyRepoWith(makeReply({ status: 'draft' })),
    }) // default staffApi returns null = org-wide access
    const result = await submitReply(deps)({ reviewId: REVIEW_ID }, ADMIN_CTX)
    expect(result.status).toBe('pending_approval')
  })
})
