// Review context — reply lifecycle use cases
// Draft, submit, approve, reject, edit-resubmit, delete, retry.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { GoogleReplyObservationStore } from '../ports/google-reply-observation-store.port'
import type { AiSuggestedDraftStore } from '../ports/ai-suggested-draft-store.port'
import type { ReplyId, ReviewId, PropertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Reply, Review } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { canForContext } from '#/shared/domain/permissions'
import { transitionReply, MAX_REPLY_LENGTH } from '../../domain/rules'
import {
  buildIdempotencyKey,
  nextPublicationCycle,
} from '../../domain/reply-publication-workflow'
import { reviewError } from '../../domain/errors'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { reconcileReplyPublication } from './reconcile-reply-publication'
import { commitTransition } from '../reply-commit'
import {
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyPublicationRequested,
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
  /** Atomic verification and persistence seam for browser-held AI suggestions. */
  aiSuggestedDraftStore?: AiSuggestedDraftStore
  /**
   * BQC-3.8: provider READ path for retryPublish's reconcile-before-retry
   * (an ambiguous publication is reconciled against Google before any new
   * send — reconcileReplyPublication never calls the publish endpoint).
   */
  googleReviewApi: GoogleReviewApiPort
  googleReplyObservationStore: GoogleReplyObservationStore
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

/** Load the review and assert the caller can access its property (D6-001). */
async function requireAccessibleReview(
  deps: ReplyDeps,
  ctx: AuthContext,
  reviewId: ReviewId,
): Promise<Review> {
  const review = await deps.reviewRepo.findById(reviewId, ctx.organizationId)
  if (!review) {
    throw reviewError('review_not_found', 'Review not found')
  }
  await assertReplyPropertyAccessible(deps, ctx, review.propertyId)
  return review
}

/**
 * Reply mutations require a manager, the reply + review rows, and property
 * access (D6-001) — the single prologue every reply mutation shares.
 */
async function requireAccessibleReply(
  deps: ReplyDeps,
  ctx: AuthContext,
  reviewId: ReviewId,
  replyNotFoundMessage = 'No reply found for this review',
): Promise<{ reply: Reply; review: Review }> {
  requireManager(ctx)
  const reply = await deps.replyRepo.findInternalByReviewId(reviewId, ctx.organizationId)
  if (!reply) {
    throw reviewError('reply_not_found', replyNotFoundMessage)
  }
  const review = await requireAccessibleReview(deps, ctx, reviewId)
  return { reply, review }
}

async function resolvePublicationAuthorizationFence(
  deps: ReplyDeps,
  review: Review,
): Promise<
  Readonly<{
    sourceEpoch: number
    materialReviewRevision: number
    baseObservationRevision: number
  }>
> {
  const head = await deps.googleReplyObservationStore.findCurrentHead({
    organizationId: review.organizationId,
    propertyId: review.propertyId,
    reviewId: review.id,
  })
  if (
    head !== null &&
    (head.sourceEpoch !== review.sourceEpoch ||
      head.materialReviewRevision !== review.sourceRevision)
  ) {
    throw reviewError(
      'invalid_transition',
      'Google reply truth must be refreshed before this reply can be authorized',
    )
  }
  return {
    sourceEpoch: review.sourceEpoch,
    materialReviewRevision: review.sourceRevision,
    baseObservationRevision: head?.observationRevision ?? 0,
  }
}
async function assertCurrentAiDraftBinding(
  deps: ReplyDeps,
  ctx: AuthContext,
  reply: Reply,
): Promise<void> {
  if (!reply.aiGenerated) return
  if (!deps.aiSuggestedDraftStore) {
    throw reviewError(
      'ai_suggestion_unavailable',
      'AI-assisted draft validation is unavailable',
    )
  }
  const status = await deps.aiSuggestedDraftStore.assertCurrentBinding({
    organizationId: ctx.organizationId,
    replyId: reply.id,
  })
  if (status === 'stale') {
    throw reviewError('ai_suggestion_stale', 'The AI-assisted draft is no longer current')
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
  replyLanguageTag?: string
  provenanceToken?: string
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
    const review = await requireAccessibleReview(deps, ctx, input.reviewId)
    const now = deps.clock()

    if (input.provenanceToken !== undefined) {
      if (!deps.aiSuggestedDraftStore) {
        throw reviewError(
          'ai_suggestion_unavailable',
          'AI suggestion acceptance is unavailable',
        )
      }
      const accepted = await deps.aiSuggestedDraftStore.accept({
        organizationId: ctx.organizationId,
        propertyId: review.propertyId,
        reviewId: input.reviewId,
        actorUserId: ctx.userId,
        text: input.text,
        provenanceToken: input.provenanceToken,
        now,
      })
      if (accepted.status === 'accepted') return accepted.reply
      const code =
        accepted.reason === 'invalid'
          ? 'ai_suggestion_invalid'
          : accepted.reason === 'expired'
            ? 'ai_suggestion_expired'
            : 'ai_suggestion_stale'
      throw reviewError(code, 'AI suggestion can no longer be accepted')
    }

    const existing = await deps.replyRepo.findInternalByReviewId(
      input.reviewId,
      ctx.organizationId,
    )
    if (existing) await assertCurrentAiDraftBinding(deps, ctx, existing)

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
          ...(input.replyLanguageTag !== undefined
            ? { replyLanguageTag: input.replyLanguageTag }
            : {}),
          rejectedBy: null,
          rejectionReason: null,
          aiGenerated: false,
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
        replyLanguageTag: input.replyLanguageTag ?? null,
        status: 'draft',
        source: 'internal',
        createdBy: ctx.userId,
        approvedBy: null,
        rejectedBy: null,
        rejectionReason: null,
        aiGenerated: false,
        stateRevision: 1,
        submittedAt: null,
        approvedAt: null,
        publishedAt: null,
        // BQC-3.8: a fresh draft has no publication workflow.
        publicationState: null,
        publicationCycle: 0,
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
    // D6-001: scope reply mutations to the caller's assigned properties.
    const { reply, review } = await requireAccessibleReply(
      deps,
      ctx,
      input.reviewId,
      'No draft reply found for this review',
    )
    await assertCurrentAiDraftBinding(deps, ctx, reply)

    const now = deps.clock()
    // BQC-3.3: guarded status update + submitted fact commit in one tx;
    // the store emits on the bus after commit.
    const submitted = await commitTransition(reply, 'pending_approval', now, () =>
      deps.commandStore.submitReply(
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
      ),
    )
    if (submitted.isErr()) throw submitted.error

    return submitted.value
  }

// ── Approve reply ─────────────────────────────────────────────────────

export type ApproveReplyInput = Readonly<{
  reviewId: ReviewId
}>

export const approveReply =
  (deps: ReplyDeps) =>
  async (input: ApproveReplyInput, ctx: AuthContext): Promise<Reply> => {
    // D6-001: scope reply mutations to the caller's assigned properties.
    const { reply, review } = await requireAccessibleReply(deps, ctx, input.reviewId)
    await assertCurrentAiDraftBinding(deps, ctx, reply)

    const now = deps.clock()
    const publicationCycle = nextPublicationCycle(reply.publicationCycle)
    const authorizationFence = await resolvePublicationAuthorizationFence(deps, review)
    const publicationIntent = reviewReplyPublicationRequested({
      replyId: reply.id,
      reviewId: reply.reviewId,
      propertyId: review.propertyId,
      organizationId: reply.organizationId,
      userId: ctx.userId,
      publicationCycle,
      ...authorizationFence,
      occurredAt: now,
    })
    // BQC-3.3: guarded status update + approved fact commit in one tx. The
    // durable review.reply.approved outbox row is the recovery record if the
    // process crashes before the enqueue below.
    // BQC-3.8: the same write authorizes the publication cycle —
    // publication_state='authorized', attempts/last-error/reconcile-due reset.
    const approvedResult = await commitTransition(reply, 'approved', now, () =>
      deps.commandStore.markPublicationAuthorized(
        reply,
        { status: 'approved', approvedBy: ctx.userId, approvedAt: now },
        {
          lifecycleEvent: reviewReplyApproved({
            replyId: reply.id,
            reviewId: reply.reviewId,
            propertyId: review.propertyId,
            organizationId: reply.organizationId,
            userId: ctx.userId,
            authorId: reply.createdBy,
            occurredAt: now,
          }),
          publicationIntent,
        },
        now,
      ),
    )
    if (approvedResult.isErr()) throw approvedResult.error
    const approved = approvedResult.value

    // Post-commit enqueue: the BullMQ queue cannot join the pg transaction.
    // The committed approved fact is the recovery record; BQC-3.8 makes
    // publication fully durable (requested → … → published state machine).
    // The saga idempotency key (sourceVersion = approval-cycle updatedAt)
    // dedupes a double enqueue of THIS approval cycle as the BullMQ jobId.
    await deps.queue.addPublishJob(
      {
        replyId: approved.id,
        organizationId: approved.organizationId,
        publicationCycle: approved.publicationCycle,
        propertyId: publicationIntent.propertyId,
        sourceEpoch: publicationIntent.sourceEpoch,
        materialReviewRevision: publicationIntent.materialReviewRevision,
        baseObservationRevision: publicationIntent.baseObservationRevision,
        // Named attribution for operator/user-triggered delayed work.
        initiator: { kind: 'user', id: ctx.userId },
      },
      {
        idempotencyKey: buildIdempotencyKey(approved.id, approved.publicationCycle),
      },
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

    const review = await requireAccessibleReview(deps, ctx, input.reviewId)

    // No-op: identical text — no write, no provider call, no fact.
    if (text === reply.text) {
      return reply
    }

    const now = deps.clock()
    const publicationCycle = nextPublicationCycle(reply.publicationCycle)
    const authorizationFence = await resolvePublicationAuthorizationFence(deps, review)
    const publicationIntent = reviewReplyPublicationRequested({
      replyId: reply.id,
      reviewId: reply.reviewId,
      propertyId: review.propertyId,
      organizationId: reply.organizationId,
      userId: ctx.userId,
      publicationCycle,
      ...authorizationFence,
      occurredAt: now,
    })

    // Guarded edit: text + status → approved + a fresh publication cycle +
    // the review.reply.updated fact — one transaction. The committed updated
    // fact is the recovery record if the process crashes before the enqueue.
    const updatedResult = await commitTransition(reply, 'approved', now, () =>
      deps.commandStore.editPublishedReply(reply, {
        text,
        lifecycleEvent: reviewReplyUpdated({
          replyId: reply.id,
          reviewId: reply.reviewId,
          propertyId: review.propertyId,
          organizationId: reply.organizationId,
          userId: ctx.userId,
          occurredAt: now,
        }),
        publicationIntent,
        now,
      }),
    )
    if (updatedResult.isErr()) throw updatedResult.error
    const updated = updatedResult.value

    await deps.queue.addPublishJob(
      {
        replyId: updated.id,
        organizationId: updated.organizationId,
        publicationCycle: updated.publicationCycle,
        propertyId: publicationIntent.propertyId,
        sourceEpoch: publicationIntent.sourceEpoch,
        materialReviewRevision: publicationIntent.materialReviewRevision,
        baseObservationRevision: publicationIntent.baseObservationRevision,
        initiator: { kind: 'user', id: ctx.userId },
      },
      {
        idempotencyKey: buildIdempotencyKey(updated.id, updated.publicationCycle),
      },
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
    // D6-001: scope reply mutations to the caller's assigned properties.
    const { reply, review } = await requireAccessibleReply(deps, ctx, input.reviewId)

    const now = deps.clock()
    // BQC-3.3: guarded status update + rejected fact commit in one tx.
    const updated = await commitTransition(reply, 'rejected', now, () =>
      deps.commandStore.rejectReply(
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
      ),
    )
    if (updated.isErr()) throw updated.error

    return updated.value
  }

// ── Delete draft ──────────────────────────────────────────────────────

export type DeleteReplyInput = Readonly<{
  reviewId: ReviewId
}>

export const deleteReply =
  (deps: ReplyDeps) =>
  async (input: DeleteReplyInput, ctx: AuthContext): Promise<void> => {
    // D6-001: scope reply mutations to the caller's assigned properties.
    const { reply } = await requireAccessibleReply(deps, ctx, input.reviewId)

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
    await requireAccessibleReview(deps, ctx, input.reviewId)
    return deps.replyRepo.findInternalByReviewId(input.reviewId, ctx.organizationId)
  }

// ── Retry publish ─────────────────────────────────────────────────────

export type RetryPublishInput = Readonly<{
  reviewId: ReviewId
}>

export const retryPublish =
  (deps: ReplyDeps) =>
  async (input: RetryPublishInput, ctx: AuthContext): Promise<Reply> => {
    // D6-001: scope reply mutations to the caller's assigned properties.
    const { reply, review } = await requireAccessibleReply(deps, ctx, input.reviewId)

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
        observationStore: deps.googleReplyObservationStore,
        clock: deps.clock,
      })({ replyId: reply.id, organizationId: ctx.organizationId })
      if (reconciled.isErr()) throw reconciled.error
      if (reconciled.value.outcome === 'confirmed_on_google') {
        const healed = await deps.replyRepo.findById(reply.id, ctx.organizationId)
        if (!healed) throw reviewError('reply_not_found', 'Reply not found')
        return healed
      }
      if (reconciled.value.outcome !== 'absent') {
        throw reviewError(
          'invalid_transition',
          'The current Google reply must be reviewed before another publication attempt',
        )
      }
    }

    const now = deps.clock()
    const publicationCycle = nextPublicationCycle(reply.publicationCycle)
    const authorizationFence = await resolvePublicationAuthorizationFence(deps, review)
    const publicationIntent = reviewReplyPublicationRequested({
      replyId: reply.id,
      reviewId: reply.reviewId,
      propertyId: review.propertyId,
      organizationId: reply.organizationId,
      userId: ctx.userId,
      publicationCycle,
      ...authorizationFence,
      occurredAt: now,
    })
    // BQC-3.8: re-authorization starts a NEW publication cycle
    // (publication_state='authorized', attempts/error/reconcile-due reset).
    // No new fact — re-approval reuses the approved state, exactly as before.
    const backToApprovedResult = await commitTransition(reply, 'approved', now, () =>
      deps.commandStore.markPublicationAuthorized(
        reply,
        { status: 'approved' },
        { lifecycleEvent: null, publicationIntent },
        now,
      ),
    )
    if (backToApprovedResult.isErr()) throw backToApprovedResult.error
    const backToApproved = backToApprovedResult.value

    // Post-commit enqueue (no new fact — re-approval reuses the approved
    // state). The retry bumps updatedAt, so the saga idempotency key differs
    // from the exhausted publish job's key and a fresh job is enqueued.
    await deps.queue.addPublishJob(
      {
        replyId: backToApproved.id,
        organizationId: backToApproved.organizationId,
        publicationCycle: backToApproved.publicationCycle,
        propertyId: publicationIntent.propertyId,
        sourceEpoch: publicationIntent.sourceEpoch,
        materialReviewRevision: publicationIntent.materialReviewRevision,
        baseObservationRevision: publicationIntent.baseObservationRevision,
        // Named attribution for operator/user-triggered delayed work.
        initiator: { kind: 'user', id: ctx.userId },
      },
      {
        idempotencyKey: buildIdempotencyKey(
          backToApproved.id,
          backToApproved.publicationCycle,
        ),
      },
    )

    return backToApproved
  }
