// Review context — reply lifecycle use cases
// Draft, submit, approve, reject, edit-resubmit, delete, retry.

import type { ReplyRepository } from '../ports/reply.repository'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyQueuePort } from '../ports/reply-queue.port'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { GoogleReplyObservationStore } from '../ports/google-reply-observation-store.port'
import type { AiSuggestedDraftStore } from '../ports/ai-suggested-draft-store.port'
import type { ReplyId, ReviewId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Reply, Review } from '../../domain/types'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  requireAccessibleReview,
  requireReplyManager as requireManager,
} from './reply-access'
import {
  assertReplySlotsFilled,
  MAX_REPLY_LENGTH,
  transitionReply,
} from '../../domain/rules'
import {
  buildIdempotencyKey,
  nextPublicationCycle,
} from '../../domain/reply-publication-workflow'
import { reviewError } from '../../domain/errors'
import { reconcileReplyPublication } from './reconcile-reply-publication'
import { commitTransition } from '../reply-commit'
import {
  reviewReplySubmitted,
  reviewReplyApproved,
  reviewReplyPublicationRequested,
  reviewReplyRejected,
  reviewReplyUpdated,
  type ReviewReplyPublicationRequested,
} from '../../domain/events'

// ── Shared ────────────────────────────────────────────────────────────

export type ReplyDeps = Readonly<{
  replyRepo: ReplyRepository
  reviewRepo: ReviewRepository
  queue: ReplyQueuePort
  /** BQC-3.3: atomic reply state mutation and outbox facts. */
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

function isSettledPublishedReply(
  reply: Reply | null,
): reply is Reply & { status: 'published'; publicationState: 'published' } {
  return reply?.status === 'published' && reply.publicationState === 'published'
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

type PublicationCommandOutcome = Readonly<{
  reply: Reply
  shouldEnqueue: boolean
}>

/**
 * One command-side chokepoint constructs the durable authorization intent and
 * performs low-latency queue admission only after the callback commits it.
 */
async function authorizeAndEnqueuePublication(
  deps: ReplyDeps,
  ctx: AuthContext,
  reply: Reply,
  review: Review,
  authorize: (
    now: Date,
    publicationIntent: ReviewReplyPublicationRequested,
  ) => Promise<PublicationCommandOutcome>,
): Promise<Reply> {
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
  const outcome = await authorize(now, publicationIntent)
  if (!outcome.shouldEnqueue) return outcome.reply

  // The queue cannot join the pg transaction. The committed intent is the
  // recovery record; the deterministic reply+cycle key dedupes admission.
  await deps.queue.addPublishJob(
    {
      replyId: outcome.reply.id,
      organizationId: outcome.reply.organizationId,
      publicationCycle: outcome.reply.publicationCycle,
      propertyId: publicationIntent.propertyId,
      sourceEpoch: publicationIntent.sourceEpoch,
      materialReviewRevision: publicationIntent.materialReviewRevision,
      baseObservationRevision: publicationIntent.baseObservationRevision,
      // Named attribution for operator/user-triggered delayed work.
      initiator: { kind: 'user', id: ctx.userId },
    },
    {
      idempotencyKey: buildIdempotencyKey(
        outcome.reply.id,
        outcome.reply.publicationCycle,
      ),
    },
  )
  return outcome.reply
}

/**
 * Split read-only provider reconciliation from retry re-authorization: this
 * path may return only settled/cancelled state and must never admit a new PUT.
 */
async function reconcileUncertainPublicationBeforeRetry(
  deps: ReplyDeps,
  ctx: AuthContext,
  reply: Reply,
): Promise<Reply> {
  const reconciled = await reconcileReplyPublication({
    replyRepo: deps.replyRepo,
    reviewRepo: deps.reviewRepo,
    googleReviewApi: deps.googleReviewApi,
    observationStore: deps.googleReplyObservationStore,
    clock: deps.clock,
  })({ replyId: reply.id, organizationId: ctx.organizationId })
  if (reconciled.isErr()) {
    const current = await deps.replyRepo.findById(reply.id, ctx.organizationId)
    if (isSettledPublishedReply(current)) return current
    if (current?.publicationState === 'cancelled') return current
    throw reconciled.error
  }
  if (reconciled.value.outcome === 'confirmed_on_google') {
    const healed = await deps.replyRepo.findById(reply.id, ctx.organizationId)
    if (!healed) throw reviewError('reply_not_found', 'Reply not found')
    return healed
  }

  const current = await deps.replyRepo.findById(reply.id, ctx.organizationId)
  if (isSettledPublishedReply(current)) return current
  if (current?.publicationState === 'cancelled') return current
  throw reviewError(
    'invalid_transition',
    'Google did not positively confirm whether this reply is live; RepKey will not send it again',
  )
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
  /** Internal-only provenance set by the property template loader. */
  templateId?: string
  templateVersion?: number
}>

export const draftReply =
  (deps: ReplyDeps) =>
  // Pre-existing (cognitive 21); WP3.1 only removed the bus dependency.
  // fallow-ignore-next-line complexity
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
    if (
      (input.templateId === undefined) !== (input.templateVersion === undefined) ||
      (input.templateVersion !== undefined && input.templateVersion < 1)
    ) {
      throw reviewError('invalid_input', 'Template provenance is incomplete')
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
    if (existing && input.templateId === undefined)
      await assertCurrentAiDraftBinding(deps, ctx, existing)

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
          ...(input.templateId !== undefined
            ? {
                templateId: input.templateId,
                templateVersion: input.templateVersion,
              }
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
        templateId: input.templateId ?? null,
        templateVersion: input.templateVersion ?? null,
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
    assertReplySlotsFilled(reply.text)
    await assertCurrentAiDraftBinding(deps, ctx, reply)

    const now = deps.clock()
    // BQC-3.3: guarded status update and submitted fact commit in one transaction.
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
    assertReplySlotsFilled(reply.text)
    await assertCurrentAiDraftBinding(deps, ctx, reply)

    return authorizeAndEnqueuePublication(
      deps,
      ctx,
      reply,
      review,
      async (now, publicationIntent) => {
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
        return { reply: approvedResult.value, shouldEnqueue: true }
      },
    )
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
    assertReplySlotsFilled(text)

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

    return authorizeAndEnqueuePublication(
      deps,
      ctx,
      reply,
      review,
      async (now, publicationIntent) => {
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
        return { reply: updatedResult.value, shouldEnqueue: true }
      },
    )
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

    if (isSettledPublishedReply(reply)) return reply

    // Any state descended from an unknown provider outcome is check-only. A
    // Google read that omits the reply is not positive no-write evidence: an
    // accepted reply can be delayed or filtered from the response. Only an
    // exact live observation may heal it; provider truth may also cancel it.
    // Neither case ever admits a second PUT.
    const requiresPositiveReconciliation =
      reply.publicationState === 'ambiguous' ||
      (reply.publicationState === 'terminal' &&
        reply.publicationLastErrorClass === 'ambiguous')
    if (requiresPositiveReconciliation) {
      return reconcileUncertainPublicationBeforeRetry(deps, ctx, reply)
    }

    return authorizeAndEnqueuePublication(
      deps,
      ctx,
      reply,
      review,
      async (now, publicationIntent) => {
        // BQC-3.8: re-authorization starts a NEW publication cycle
        // (publication_state='authorized', attempts/error/reconcile-due reset).
        // No new lifecycle fact — re-approval reuses the approved state.
        const backToApprovedResult = await commitTransition(reply, 'approved', now, () =>
          deps.commandStore.markPublicationAuthorized(
            reply,
            { status: 'approved' },
            { lifecycleEvent: null, publicationIntent },
            now,
          ),
        )
        if (backToApprovedResult.isErr()) {
          // The authorization CAS can lose to the same legitimate publication
          // transition. Durable published state means the requested outcome won,
          // but no new intent was committed and no enqueue is needed.
          const current = await deps.replyRepo.findById(reply.id, ctx.organizationId)
          if (isSettledPublishedReply(current)) {
            return { reply: current, shouldEnqueue: false }
          }
          throw backToApprovedResult.error
        }
        return { reply: backToApprovedResult.value, shouldEnqueue: true }
      },
    )
  }
