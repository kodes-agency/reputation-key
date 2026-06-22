// Review context — reply lifecycle use cases
// Draft, submit, approve, reject, edit-resubmit, delete, retry.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  ReplyId,
  ReviewId,
  OrganizationId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type { Role } from '#/shared/domain/roles'
import type { Reply } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { can } from '#/shared/domain/permissions'
import { transitionReply, MAX_REPLY_LENGTH } from '../../domain/rules'
import { reviewError } from '../../domain/errors'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import {
  reviewReplyPublished,
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyRejected,
  reviewReplyPublishFailed,
} from '../../domain/events'
import { getLogger } from '#/shared/observability/logger'

// ── Shared ────────────────────────────────────────────────────────────

function requireManager(role: Role) {
  if (!can(role, 'reply.manage')) {
    throw reviewError('unauthorized', 'Only managers and admins can manage replies')
  }
}

export type ReplyDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  queue: ReplyQueuePort
  events: EventBus
  clock: () => Date
  idGen: () => ReplyId
  staffPublicApi: StaffPublicApi
}>

/** Enforce property-assignment scoping for reply mutations (D6-001).
 *  AccountAdmin bypasses (getAccessiblePropertyIds returns null);
 *  PropertyManager is scoped to assigned properties only. */
async function assertReplyPropertyAccessible(
  deps: ReplyDeps,
  caller: { organizationId: OrganizationId; userId: UserId; role: Role },
  propertyId: PropertyId,
): Promise<void> {
  const accessible = await isPropertyAccessible(
    (orgId, userId, role) =>
      deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, role),
    caller.organizationId,
    caller.userId,
    caller.role,
    propertyId,
  )
  if (!accessible) {
    throw reviewError('forbidden', 'No access to this property', { propertyId })
  }
}

export type DraftReply = ReturnType<typeof draftReply>
export type SubmitReply = ReturnType<typeof submitReply>
export type ApproveReply = ReturnType<typeof approveReply>
export type RejectReply = ReturnType<typeof rejectReply>
export type DeleteReply = ReturnType<typeof deleteReply>
export type GetReply = ReturnType<typeof getReply>
export type RetryPublish = ReturnType<typeof retryPublish>

export type DraftReplyInput = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  userId: UserId
  role: Role
}>

export const draftReply =
  (deps: ReplyDeps) =>
  async (input: DraftReplyInput): Promise<Reply> => {
    requireManager(input.role)

    if (!input.text.trim()) {
      throw reviewError('invalid_reply', 'Reply text cannot be empty')
    }
    if (input.text.length > MAX_REPLY_LENGTH) {
      throw reviewError(
        'invalid_reply',
        `Reply text exceeds ${MAX_REPLY_LENGTH} characters`,
      )
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, input.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, input, review.propertyId)

    const existing = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      input.organizationId,
    )

    const now = deps.clock()

    if (existing) {
      if (existing.status !== 'draft' && existing.status !== 'rejected') {
        throw reviewError(
          'invalid_transition',
          `Cannot edit reply in ${existing.status} status`,
        )
      }
      return deps.replyRepo.upsert(
        {
          ...existing,
          text: input.text,
          status: 'draft',
          rejectedBy: null,
          rejectionReason: null,
        },
        now,
      )
    }

    return deps.replyRepo.upsert(
      {
        id: deps.idGen(),
        reviewId: input.reviewId,
        organizationId: input.organizationId,
        text: input.text,
        status: 'draft',
        source: 'internal',
        createdBy: input.userId,
        approvedBy: null,
        rejectedBy: null,
        rejectionReason: null,
        aiGenerated: false,
        submittedAt: null,
        approvedAt: null,
        publishedAt: null,
      },
      now,
    )
  }

// ── Submit for approval ───────────────────────────────────────────────

export type SubmitReplyInput = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

export const submitReply =
  (deps: ReplyDeps) =>
  async (input: SubmitReplyInput): Promise<Reply> => {
    requireManager(input.role)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      input.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No draft reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, input.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, input, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'pending_approval', now)
    if (transitioned.isErr()) throw transitioned.error
    const submitted = await deps.replyRepo.upsert(
      { ...transitioned.value, submittedAt: now },
      now,
    )

    await deps.events.emit(
      reviewReplySubmitted({
        replyId: submitted.id,
        reviewId: submitted.reviewId,
        propertyId: review.propertyId,
        organizationId: submitted.organizationId,
        userId: input.userId,
        occurredAt: now,
      }),
    )

    return submitted
  }

// ── Approve reply ─────────────────────────────────────────────────────

export type ApproveReplyInput = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

export const approveReply =
  (deps: ReplyDeps) =>
  async (input: ApproveReplyInput): Promise<Reply> => {
    requireManager(input.role)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      input.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, input.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, input, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'approved', now)
    if (transitioned.isErr()) throw transitioned.error
    const approved = await deps.replyRepo.upsert(
      { ...transitioned.value, approvedBy: input.userId, approvedAt: now },
      now,
    )

    await deps.queue.addPublishJob({
      replyId: approved.id,
      organizationId: approved.organizationId,
    })

    await deps.events.emit(
      reviewReplyApproved({
        replyId: approved.id,
        reviewId: approved.reviewId,
        propertyId: review.propertyId,
        organizationId: approved.organizationId,
        userId: input.userId,
        authorId: approved.createdBy,
        occurredAt: now,
      }),
    )

    return approved
  }

// ── Reject reply ──────────────────────────────────────────────────────

export type RejectReplyInput = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  reason?: string
  userId: UserId
  role: Role
}>

export const rejectReply =
  (deps: ReplyDeps) =>
  async (input: RejectReplyInput): Promise<Reply> => {
    requireManager(input.role)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      input.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, input.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, input, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'rejected', now)
    if (transitioned.isErr()) throw transitioned.error
    const updated = await deps.replyRepo.upsert(
      {
        ...transitioned.value,
        rejectedBy: input.userId,
        rejectionReason: input.reason ?? null,
      },
      now,
    )

    await deps.events.emit(
      reviewReplyRejected({
        replyId: updated.id,
        reviewId: updated.reviewId,
        propertyId: review.propertyId,
        organizationId: updated.organizationId,
        userId: input.userId,
        authorId: updated.createdBy,
        reason: input.reason ?? null,
        occurredAt: now,
      }),
    )

    return updated
  }

// ── Delete draft ──────────────────────────────────────────────────────

export type DeleteReplyInput = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

export const deleteReply =
  (deps: ReplyDeps) =>
  async (input: DeleteReplyInput): Promise<void> => {
    requireManager(input.role)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      input.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, input.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, input, review.propertyId)

    if (reply.status !== 'draft' && reply.status !== 'rejected') {
      throw reviewError('invalid_transition', 'Can only delete draft or rejected replies')
    }

    await deps.replyRepo.deleteById(reply.id, input.organizationId)
  }

// ── Get reply for review ──────────────────────────────────────────────

export type GetReplyInput = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

export const getReply =
  (deps: ReplyDeps) =>
  async (input: GetReplyInput): Promise<Reply | null> => {
    requireManager(input.role)
    return deps.replyRepo.findInternalByReviewId(input.reviewId, input.organizationId)
  }

// ── Mark published (called by publish job on success) ─────────────────

export type MarkPublishedInput = Readonly<{
  replyId: ReplyId
  organizationId: OrganizationId
}>

export const markReplyPublished =
  (deps: ReplyDeps) =>
  async (input: MarkPublishedInput): Promise<Reply> => {
    const reply = await deps.replyRepo.findById(input.replyId, input.organizationId)
    if (!reply) {
      throw reviewError('reply_not_found', 'Reply not found')
    }

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'published', now)
    if (transitioned.isErr()) throw transitioned.error

    const review = await deps.reviewRepo.findById(reply.reviewId, input.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found for published reply')
    }

    const published = await deps.replyRepo.upsert(transitioned.value, now)

    await deps.events.emit(
      reviewReplyPublished({
        replyId: published.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: published.createdBy,
        authorId: published.createdBy,
        occurredAt: now,
      }),
    )

    return published
  }

// ── Mark publish failed (called by publish job on final failure) ──────

export type MarkPublishFailedInput = Readonly<{
  replyId: ReplyId
  organizationId: OrganizationId
}>

export const markReplyPublishFailed =
  (deps: ReplyDeps) =>
  async (input: MarkPublishFailedInput): Promise<Reply> => {
    const reply = await deps.replyRepo.findById(input.replyId, input.organizationId)
    if (!reply) {
      throw reviewError('reply_not_found', 'Reply not found')
    }

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'publish_failed', now)
    if (transitioned.isErr()) throw transitioned.error
    const updated = await deps.replyRepo.upsert(transitioned.value, now)

    // Emit event after status update — failure should not break the update
    try {
      const review = await deps.reviewRepo.findById(reply.reviewId, input.organizationId)
      if (review) {
        await deps.events.emit(
          reviewReplyPublishFailed({
            replyId: updated.id,
            reviewId: updated.reviewId,
            propertyId: review.propertyId,
            organizationId: updated.organizationId,
            authorId: updated.createdBy,
            occurredAt: now,
          }),
        )
      }
    } catch (e) {
      // Status update succeeded; event emission failure is non-critical but logged
      getLogger()
        .child({ replyId: updated.id })
        .error({ err: e }, 'Failed to emit reply publish failed event')
    }

    return updated
  }

// ── Retry publish ─────────────────────────────────────────────────────

export type RetryPublishInput = Readonly<{
  reviewId: ReviewId
  organizationId: OrganizationId
  userId: UserId
  role: Role
}>

export const retryPublish =
  (deps: ReplyDeps) =>
  async (input: RetryPublishInput): Promise<Reply> => {
    requireManager(input.role)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      input.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, input.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, input, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'approved', now)
    if (transitioned.isErr()) throw transitioned.error
    const backToApproved = await deps.replyRepo.upsert(transitioned.value, now)

    await deps.queue.addPublishJob({
      replyId: backToApproved.id,
      organizationId: backToApproved.organizationId,
    })

    return backToApproved
  }
