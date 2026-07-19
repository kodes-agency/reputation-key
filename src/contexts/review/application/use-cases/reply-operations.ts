// Review context — reply lifecycle use cases
// Draft, submit, approve, reject, edit-resubmit, delete, retry.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { ReplyId, ReviewId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Reply } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { transitionReply, MAX_REPLY_LENGTH } from '../../domain/rules'
import { buildIdempotencyKey } from '../../domain/reply-publication-workflow'
import { reviewError } from '../../domain/errors'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { reconcileReplyPublication } from './reconcile-reply-publication'
import {
  reviewReplyPublished,
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyRejected,
  reviewReplyUpdated,
} from '../../domain/events'

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
  /**
   * BQC-3.3: atomic reply state mutation + outbox fact (+ post-commit bus
   * emit). All fact-emitting reply transitions route through this store.
   */
  commandStore: ReplyCommandStore
  /**
   * BQC-3.8: provider READ path for retryPublish's reconcile-before-retry
   * (an ambiguous publication is reconciled against Google before any new
   * send — reconcileReplyPublication never calls the publish endpoint).
   */
  googleReviewApi: GoogleReviewApiPort
  clock: () => Date
  idGen: () => ReplyId
  staffPublicApi: StaffPublicApi
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
        // BQC-3.8: a fresh draft has no publication workflow.
        publicationState: null,
        publicationAttempts: 0,
        publicationLastErrorClass: null,
        reconcileDueAt: null,
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
    // BQC-3.3: guarded status update + submitted fact commit in one tx;
    // the store emits on the bus after commit. Null = lost TOCTOU race.
    const submitted = await deps.commandStore.submitReply(
      reply,
      { status: 'pending_approval', submittedAt: now },
      reviewReplySubmitted({
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: ctx.userId,
        occurredAt: now,
      }),
      now,
    )
    if (!submitted) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

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
    // BQC-3.3: guarded status update + approved fact commit in one tx. The
    // durable review.reply.approved outbox row is the recovery record if the
    // process crashes before the enqueue below.
    // BQC-3.8: the same write authorizes the publication cycle —
    // publication_state='authorized', attempts/last-error/reconcile-due reset.
    const approved = await deps.commandStore.markPublicationAuthorized(
      reply,
      { status: 'approved', approvedBy: ctx.userId, approvedAt: now },
      reviewReplyApproved({
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: ctx.userId,
        authorId: reply.createdBy,
        occurredAt: now,
      }),
      now,
    )
    if (!approved) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    // Post-commit enqueue: the BullMQ queue cannot join the pg transaction.
    // The committed approved fact is the recovery record; BQC-3.8 makes
    // publication fully durable (requested → … → published state machine).
    // The saga idempotency key (sourceVersion = approval-cycle updatedAt)
    // dedupes a double enqueue of THIS approval cycle as the BullMQ jobId.
    await deps.queue.addPublishJob(
      {
        replyId: approved.id,
        organizationId: approved.organizationId,
        // BQC-3.2: named initiator for operator/user-triggered delayed work.
        policy: { initiator: { kind: 'user', id: ctx.userId } },
      },
      { idempotencyKey: buildIdempotencyKey(approved.id, approved.updatedAt.getTime()) },
    )

    return approved
  }

// ── Edit published reply (edit-and-republish) ─────────────────────────

export type EditPublishedReplyInput = Readonly<{
  reviewId: ReviewId
  text: string
}>

/**
 * Edit the text of a PUBLISHED internal reply and republish it. The write
 * re-enters the durable publication machine (published → approved with a
 * fresh cycle), the review.reply.updated fact records the edit atomically,
 * and the existing publish job performs the provider upsert — the GBP reply
 * update is an upsert, so republishing can never duplicate the reply.
 *
 * No-ops when the trimmed text equals the current text (no write, no enqueue).
 * Mirrors are read-only: editing a google_sync reply is not supported here
 * (external edits happen in the GBP UI and sync back to the mirror).
 */
export const editPublishedReply =
  (deps: ReplyDeps) =>
  async (input: EditPublishedReplyInput, ctx: AuthContext): Promise<Reply> => {
    requireManager(ctx)

    const text = input.text.trim()
    if (text.length === 0) {
      throw reviewError('invalid_reply', 'Reply text cannot be empty')
    }
    if (text.length > MAX_REPLY_LENGTH) {
      throw reviewError(
        'invalid_reply',
        `Reply text exceeds ${MAX_REPLY_LENGTH} characters`,
      )
    }

    const reply = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )
    if (!reply) {
      throw reviewError('reply_not_found', 'No reply found for this review')
    }
    if (reply.status !== 'published') {
      throw reviewError(
        'invalid_transition',
        'Only a published reply can be edited and republished',
      )
    }

    const review = await deps.reviewRepo.findById(input.reviewId, ctx.organizationId)
    if (!review) {
      throw reviewError('review_not_found', 'Review not found')
    }
    await assertReplyPropertyAccessible(deps, ctx, review.propertyId)

    // No-op: identical text — no write, no provider call, no fact.
    if (text === reply.text) {
      return reply
    }

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'approved', now)
    if (transitioned.isErr()) throw transitioned.error

    // Guarded edit: text + status → approved + a fresh publication cycle +
    // the review.reply.updated fact — one transaction. The committed updated
    // fact is the recovery record if the process crashes before the enqueue.
    const updated = await deps.commandStore.editPublishedReply(reply, {
      text,
      event: reviewReplyUpdated({
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: ctx.userId,
        occurredAt: now,
      }),
      now,
    })
    if (!updated) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    await deps.queue.addPublishJob(
      {
        replyId: updated.id,
        organizationId: updated.organizationId,
        policy: { initiator: { kind: 'user', id: ctx.userId } },
      },
      { idempotencyKey: buildIdempotencyKey(updated.id, updated.updatedAt.getTime()) },
    )

    return updated
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
    // BQC-3.3: guarded status update + rejected fact commit in one tx.
    const updated = await deps.commandStore.rejectReply(
      reply,
      {
        status: 'rejected',
        rejectedBy: ctx.userId,
        rejectionReason: input.reason ?? null,
      },
      reviewReplyRejected({
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: ctx.userId,
        authorId: reply.createdBy,
        reason: input.reason ?? null,
        occurredAt: now,
      }),
      now,
    )
    if (!updated) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

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

    // BQC-3.3: guarded status update + published fact commit in one tx.
    // The publish runs from the publish-reply BullMQ job (no user actor); the
    // fact carries userId: null (system) with authorId as the original author.
    const published = await deps.commandStore.markPublished(
      reply,
      { status: 'published', publishedAt: now },
      reviewReplyPublished({
        replyId: reply.id,
        reviewId: reply.reviewId,
        propertyId: review.propertyId,
        organizationId: reply.organizationId,
        userId: null,
        authorId: reply.createdBy,
        occurredAt: now,
      }),
      now,
    )
    if (!published) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    return published
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

    // BQC-3.8: reconcile-before-retry for an AMBIGUOUS publication. The
    // previous send may have landed on Google — re-read provider state first:
    //   provider shows the reply → heal to published and STOP (no re-enqueue,
    //     no duplicate send);
    //   provider does not → the send never landed; fall through to the normal
    //     re-approve + enqueue below.
    if (reply.publicationState === 'ambiguous') {
      const reconciled = await reconcileReplyPublication({
        replyRepo: deps.replyRepo,
        reviewRepo: deps.reviewRepo,
        googleReviewApi: deps.googleReviewApi,
        commandStore: deps.commandStore,
        clock: deps.clock,
      })({ replyId: reply.id, organizationId: ctx.organizationId })
      if (reconciled.isErr()) throw reconciled.error
      if (reconciled.value.outcome === 'published') {
        const healed = await deps.replyRepo.findById(reply.id, ctx.organizationId)
        if (!healed) throw reviewError('reply_not_found', 'Reply not found')
        return healed
      }
    }

    const now = deps.clock()
    const transitioned = transitionReply(reply, 'approved', now)
    if (transitioned.isErr()) throw transitioned.error
    // BQC-3.8: re-authorization starts a NEW publication cycle
    // (publication_state='authorized', attempts/error/reconcile-due reset).
    // No new fact — re-approval reuses the approved state, exactly as before.
    const backToApproved = await deps.commandStore.markPublicationAuthorized(
      reply,
      { status: 'approved' },
      null,
      now,
    )
    if (!backToApproved) {
      throw reviewError('invalid_transition', 'Reply status changed concurrently')
    }

    // Post-commit enqueue (no new fact — re-approval reuses the approved
    // state). The retry bumps updatedAt, so the saga idempotency key differs
    // from the exhausted publish job's key and a fresh job is enqueued.
    await deps.queue.addPublishJob(
      {
        replyId: backToApproved.id,
        organizationId: backToApproved.organizationId,
        // BQC-3.2: named initiator for operator/user-triggered delayed work.
        policy: { initiator: { kind: 'user', id: ctx.userId } },
      },
      {
        idempotencyKey: buildIdempotencyKey(
          backToApproved.id,
          backToApproved.updatedAt.getTime(),
        ),
      },
    )

    return backToApproved
  }
