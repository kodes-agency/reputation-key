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
import {
  reviewId,
  replyId,
  organizationId,
  userId as toUserId,
  propertyId,
} from '#/shared/domain/ids'
const ORG_ID = organizationId('org-1')
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
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<ReplyDeps> = {}): ReplyDeps {
  return {
    replyRepo: {
      upsert: vi.fn(async (r: Reply) => r),
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
    const result = await draftReply(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
      text: 'Thank you!',
    })
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
    const result = await draftReply(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
      text: 'Updated reply',
    })
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
    const result = await draftReply(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
      text: 'Improved reply',
    })
    expect(result.status).toBe('draft')
    expect(result.rejectionReason).toBeNull()
    expect(result.rejectedBy).toBeNull()
  })

  it('rejects empty text', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID, text: '' }),
    ).rejects.toThrow()
  })

  it('rejects text exceeding max length', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID, text: 'x'.repeat(4097) }),
    ).rejects.toThrow()
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(
      draftReply(deps)({ ...STAFF_CTX, reviewId: REVIEW_ID, text: 'Hi' }),
    ).rejects.toThrow()
  })

  it('allows AccountAdmin role', async () => {
    const deps = makeDeps()
    const result = await draftReply(deps)({
      ...ADMIN_CTX,
      reviewId: REVIEW_ID,
      text: 'Admin reply',
    })
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
      draftReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID, text: 'Edit' }),
    ).rejects.toThrow()
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
    const result = await submitReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID })
    expect(result.status).toBe('pending_approval')
  })

  it('rejects if no reply exists', async () => {
    const deps = makeDeps()
    await expect(
      submitReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID }),
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
      submitReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID }),
    ).rejects.toThrow()
  })

  it('emits replySubmitted event with correct data', async () => {
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
    await submitReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID })
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('reply.submitted')
    expect(emittedEvent.replyId).toBe(REPLY_ID)
    expect(emittedEvent.reviewId).toBe(REVIEW_ID)
    expect(emittedEvent.propertyId).toBe(PROP_ID)
    expect(emittedEvent.organizationId).toBe(ORG_ID)
    expect(emittedEvent.userId).toBe(USER_ID)
    expect(emittedEvent.occurredAt).toBe(NOW)
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
    const result = await approveReply(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
    })
    expect(result.status).toBe('approved')
    expect(result.approvedBy).toBe(USER_ID)
    expect(deps.queue.addPublishJob).toHaveBeenCalledWith({
      replyId: REPLY_ID,
      organizationId: ORG_ID,
    })
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
      approveReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID }),
    ).rejects.toThrow()
  })

  it('emits replyApproved event with correct data', async () => {
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
    await approveReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID })
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('reply.approved')
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
    const result = await rejectReply(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
      reason: 'Tone too aggressive',
    })
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
    const result = await rejectReply(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
    })
    expect(result.rejectionReason).toBeNull()
  })

  it('emits replyRejected event with correct data', async () => {
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
    await rejectReply(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
      reason: 'Tone too aggressive',
    })
    expect(deps.events.emit).toHaveBeenCalledTimes(1)
    const emittedEvent = (deps.events.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(emittedEvent._tag).toBe('reply.rejected')
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
    await deleteReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID })
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
      deleteReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID }),
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
    const result = await getReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID })
    expect(result).toEqual(reply)
  })

  it('returns null when no reply exists', async () => {
    const deps = makeDeps()
    const result = await getReply(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID })
    expect(result).toBeNull()
  })

  it('blocks staff role', async () => {
    const deps = makeDeps()
    await expect(getReply(deps)({ ...STAFF_CTX, reviewId: REVIEW_ID })).rejects.toThrow()
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
    const result = await retryPublish(deps)({
      ...MANAGER_CTX,
      reviewId: REVIEW_ID,
    })
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
      retryPublish(deps)({ ...MANAGER_CTX, reviewId: REVIEW_ID }),
    ).rejects.toThrow()
  })
})
