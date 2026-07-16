// Review context — reply lifecycle use cases
// Draft, submit, approve, reject, edit-resubmit, delete, retry.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import type { EventBus } from '#/shared/events/event-bus'
import { emitAndRecord } from '#/shared/outbox'
import type { ReplyId, ReviewId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Reply } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { transitionReply, MAX_REPLY_LENGTH } from '../../domain/rules'
import { reviewError } from '../../domain/errors'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import {
  reviewReplyPublished,
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyRejected,
  reviewReplyPublishFailed,
} from '../../domain/events'
import { getLogger } from '#/shared/observability/logger'

// ── Shared ────────────────────────────────────────────────────────────

function requireManager(ctx: AuthContext) {
  if (!canForContext(ctx, 'reply.manage')) {
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
  /** Outbox repository for durable event recording (PRE17A A4 expand phase). */
  outboxRepo?: import('#/shared/outbox').OutboxRepository
}>

/** Enforce property-assignment scoping for reply mutations (D6-001).
 *  Scope resolved per-permission (reply.manage): org-wide scope (AccountAdmin)
 *  → all accessible; assigned scope (PropertyManager) → assigned properties. */
async function assertReplyPropertyAccessible(
  deps: ReplyDeps,
  ctx: AuthContext,
  propertyId: PropertyId,
): Promise<void> {
  const accessible = await isPropertyAccessibleForPermission(
    (orgId, userId, orgWide) =>
      deps.staffPublicApi.getAccessiblePropertyIds(orgId, userId, orgWide),
    ctx,
    'reply.manage',
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
  text: string
}>

export const draftReply =
  (deps: ReplyDeps) =>
  async (input: DraftReplyInput, ctx: AuthContext): Promise<Reply> => {
    requireManager(ctx)

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
    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)

    const existing = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )

    const now = deps.clock()

    if (existing) {
      // Validate the (re-)draft transition through the single authority.
      // `draft → draft` covers in-place edits; `rejected → draft` covers re-drafts.
      const transitioned = transitionReply(existing, 'draft', now)
      if (transitioned.isErr()) throw transitioned.error
      const redrafted = await deps.replyRepo.conditionalUpdate(
        existing.id,
        ctx.organizationId,
        [existing.status],
        {
          status: 'draft',
          text: input.text,
          rejectedBy: null,
          rejectionReason: null,
        },
        now,
      )
      if (!redrafted) {
        throw reviewError('invalid_transition', 'Reply status changed concurrently')
      }
      return redrafted
    }

    return deps.replyRepo.upsert(
      {
        id: deps.idGen(),
        reviewId: input.reviewId,
        organizationId: ctx.organizationId,
        text: input.text,
        status: 'draft',
        source: 'internal',
        createdBy: ctx.userId,
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
}>

export const submitReply =
  (deps: ReplyDeps) =>
  async (input: SubmitReplyInput, ctx: AuthContext): Promise<Reply> => {
    requireManager(ctx)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No draft reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'pending_approval', now)
    if (transitioned.isErr()) throw transitioned.error
    const submitted = await deps.replyRepo.conditionalUpdate(
      reply.id,
      ctx.organizationId,
      [reply.status],
      { status: 'pending_approval', submittedAt: now },
      now,
    )
    if (!submitted) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      reviewReplySubmitted({
        replyId: submitted.id,
        reviewId: submitted.reviewId,
        propertyId: review.propertyId,
        organizationId: submitted.organizationId,
        userId: ctx.userId,
        occurredAt: now,
      }),
    )

    return submitted
  }

// ── Approve reply ─────────────────────────────────────────────────────

export type ApproveReplyInput = Readonly<{
  reviewId: ReviewId
}>

export const approveReply =
  (deps: ReplyDeps) =>
  async (input: ApproveReplyInput, ctx: AuthContext): Promise<Reply> => {
    requireManager(ctx)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'approved', now)
    if (transitioned.isErr()) throw transitioned.error
    const approved = await deps.replyRepo.conditionalUpdate(
      reply.id,
      ctx.organizationId,
      [reply.status],
      { status: 'approved', approvedBy: ctx.userId, approvedAt: now },
      now,
    )
    if (!approved) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    await deps.queue.addPublishJob({
      replyId: approved.id,
      organizationId: approved.organizationId,
    })

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      reviewReplyApproved({
        replyId: approved.id,
        reviewId: approved.reviewId,
        propertyId: review.propertyId,
        organizationId: approved.organizationId,
        userId: ctx.userId,
        authorId: approved.createdBy,
        occurredAt: now,
      }),
    )

    return approved
  }

// ── Reject reply ──────────────────────────────────────────────────────

export type RejectReplyInput = Readonly<{
  reviewId: ReviewId
  reason?: string
}>

export const rejectReply =
  (deps: ReplyDeps) =>
  async (input: RejectReplyInput, ctx: AuthContext): Promise<Reply> => {
    requireManager(ctx)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'rejected', now)
    if (transitioned.isErr()) throw transitioned.error
    const updated = await deps.replyRepo.conditionalUpdate(
      reply.id,
      ctx.organizationId,
      [reply.status],
      {
        status: 'rejected',
        rejectedBy: ctx.userId,
        rejectionReason: input.reason ?? null,
      },
      now,
    )
    if (!updated) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      reviewReplyRejected({
        replyId: updated.id,
        reviewId: updated.reviewId,
        propertyId: review.propertyId,
        organizationId: updated.organizationId,
        userId: ctx.userId,
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
}>

export const deleteReply =
  (deps: ReplyDeps) =>
  async (input: DeleteReplyInput, ctx: AuthContext): Promise<void> => {
    requireManager(ctx)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)

    if (reply.status !== 'draft' && reply.status !== 'rejected') {
      throw reviewError('invalid_transition', 'Can only delete draft or rejected replies')
    }

    await deps.replyRepo.deleteById(reply.id, ctx.organizationId)
  }

// ── Get reply for review ──────────────────────────────────────────────

export type GetReplyInput = Readonly<{
  reviewId: ReviewId
}>

export const getReply =
  (deps: ReplyDeps) =>
  async (input: GetReplyInput, ctx: AuthContext): Promise<Reply | null> => {
    requireManager(ctx)
    // D6-001: scope the reply read to the caller's assigned properties — same guard
    // the mutations use. Without it a PropertyManager could read other properties' drafts.
    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)
    return deps.replyRepo.findInternalByReviewId(input.reviewId, ctx.organizationId)
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

    const published = await deps.replyRepo.conditionalUpdate(
      reply.id,
      input.organizationId,
      [reply.status],
      { status: 'published', publishedAt: now },
      now,
    )
    if (!published) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    // The publish runs from the publish-reply BullMQ job (no user actor); emit
    // userId: null (system) keeping authorId as the original reply author.
    await emitAndRecord(
      deps.events,
      deps.outboxRepo,
      reviewReplyPublished({
        replyId: published.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: null,
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
    const updated = await deps.replyRepo.conditionalUpdate(
      reply.id,
      input.organizationId,
      [reply.status],
      { status: 'publish_failed' },
      now,
    )
    if (!updated) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    // Emit event after status update — failure should not break the update
    try {
      const review = await deps.reviewRepo.findById(reply.reviewId, input.organizationId)
      if (review) {
        await emitAndRecord(
          deps.events,
          deps.outboxRepo,
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
}>

export const retryPublish =
  (deps: ReplyDeps) =>
  async (input: RetryPublishInput, ctx: AuthContext): Promise<Reply> => {
    requireManager(ctx)

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }

    // D6-001: scope reply mutations to the caller's assigned properties.
    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'approved', now)
    if (transitioned.isErr()) throw transitioned.error
    const backToApproved = await deps.replyRepo.conditionalUpdate(
      reply.id,
      ctx.organizationId,
      [reply.status],
      { status: 'approved' },
      now,
    )
    if (!backToApproved) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    await deps.queue.addPublishJob({
      replyId: backToApproved.id,
      organizationId: backToApproved.organizationId,
    })

    return backToApproved
  }
