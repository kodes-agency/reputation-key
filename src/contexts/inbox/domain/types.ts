// Inbox context — domain types
// Per architecture: "Domain types use Readonly<> on every field."

import type {
  InboxItemId,
  InboxNoteId,
  OrganizationId,
  PropertyId,
  UserId,
  ReviewId,
  FeedbackId,
} from '#/shared/domain/ids'

export type InboxStatus = 'open' | 'closed'
export type SourceType = 'review' | 'feedback'

export type ReplyStatus =
  'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected' | 'publish_failed'

export type ReplyPublicationState =
  | 'requested'
  | 'authorized'
  | 'sending'
  | 'pending_observation'
  | 'published'
  | 'terminal'
  | 'ambiguous'
  | 'cancelled'

export type ReplyPublicationFailureClass =
  'terminal_rejection' | 'retryable' | 'ambiguous'

export type HandlingCycleOpenReason =
  | 'legacy_backfill'
  | 'review_observed'
  | 'feedback_submitted'
  | 'material_revision_changed'
  | 'manual_reopen'
  | 'provider_reply_deleted'
  | 'provider_reply_diverged'

/** Compatibility name retained while callers migrate to source-neutral cycles. */
export type ReviewHandlingCycleOpenReason = HandlingCycleOpenReason

export type HandlingCycleCloseReason =
  | 'confirmed_on_google'
  | 'external_reply_observed'
  | 'guest_withdrawn'
  | 'private_feedback_handled'
  | 'source_ineligible'
  | 'superseded_by_source_revision'

export type HandlingCycleTransitionKind = 'opened' | 'closed' | 'reopened'

export type HandlingCycleActorType = 'user' | 'guest' | 'provider' | 'system'

export type ManualReopenReason =
  | 'guest_follow_up_still_needed'
  | 'internal_follow_up_still_needed'
  | 'new_information'
  | 'correcting_handling_status'
  | 'other'

/** Immutable opening record for one numbered source work episode. */
export type HandlingCycle = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  sourceRevision: number
  openedReason: HandlingCycleOpenReason
  manualReopenReason: ManualReopenReason | null
  manualReopenExplanation: string | null
  supersedesCycleNumber: number | null
  openedBy: UserId | null
  openedAt: Date
}>

/** Mutable, revision-fenced pointer to the one current actionable cycle. */
export type HandlingCycleHead = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  currentCycleNumber: number
  currentSourceRevision: number
  stateRevision: number
  status: InboxStatus
}>

/** Append-only lifecycle evidence. The head is only a projection of this log. */
export type HandlingCycleTransition = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  stateRevision: number
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  sourceRevision: number
  kind: HandlingCycleTransitionKind
  transitionReason:
    HandlingCycleOpenReason | HandlingCycleCloseReason | ManualReopenReason
  actorType: HandlingCycleActorType
  actorUserId: UserId | null
  triggerEventId: string | null
  transitionedAt: Date
}>

/**
 * Review compatibility views retain the established field names while the
 * persistence authority is source-neutral. New cross-source code should use
 * `HandlingCycle` / `HandlingCycleHead` directly.
 */
export type ReviewHandlingCycle = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  materialReviewRevision: number
  openedReason: HandlingCycleOpenReason
  manualReopenReason: ManualReopenReason | null
  manualReopenExplanation: string | null
  supersedesCycleNumber: number | null
  openedBy: UserId | null
  openedAt: Date
  sourceType?: 'review'
  sourceId?: ReviewId
  sourceRevision?: number
}>

export type ReviewHandlingCycleHead = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  currentCycleNumber: number
  currentMaterialReviewRevision: number
  stateRevision: number
  status: InboxStatus
  sourceType?: 'review'
  sourceId?: ReviewId
  currentSourceRevision?: number
}>

export type InboxItemReplyState = Readonly<{
  status: ReplyStatus
  publicationState: ReplyPublicationState | null
  publicationLastErrorClass: ReplyPublicationFailureClass | null
  /**
   * Set while RepKey's automatic Google checks still own the publication. An
   * uncertain publish with a due time waits for Google; without one it needs a
   * person (D8, `#/shared/domain/reply-queue-stage.ts`). Every list read carries
   * it; it is optional only so hand-built snapshots that predate D8 stay valid,
   * and a missing value reads as "no automatic check scheduled".
   */
  reconcileDueAt?: Date | null
  updatedAt: Date
}>

export type InboxItem = Readonly<{
  id: InboxItemId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  status: InboxStatus
  // Escalation flag — orthogonal to status (ADR 0055). An item can be
  // closed + still flagged. Lifecycle: not flagged -> flagged -> acknowledged.
  isEscalated: boolean
  escalatedAt: Date | null
  escalatedBy: UserId | null
  escalationResolvedAt: Date | null
  escalationResolvedBy: UserId | null
  rating: number | null
  sourceDate: Date
  platform: string | null
  snippet: string | null
  /** Governed list-content state. Absent on unenriched command/detail reads. */
  contentAvailability?: 'text' | 'rating_only' | 'unavailable'
  assignedTo: UserId | null
  reviewerName: string | null
  propertyName: string | null
  /** Live review-language metadata; null for feedback or unavailable content. */
  reviewLanguageCode?: string | null
  /** Current governed AI attention. Null means unavailable or not enriched. */
  attention?: 'urgent' | 'high' | 'medium' | 'low' | null
  /** Governed reply state for the row chip. Absent on unenriched reads and for actors without reply.manage. */
  replyState?: InboxItemReplyState | null
  closedAt: Date | null
  firstReplySubmittedAt: Date | null
  firstReplyPublishedAt: Date | null
  /** Monotonic optimistic-concurrency fence for human-authored commands. */
  commandRevision: number
  createdAt: Date
  updatedAt: Date
}>

export type InboxNote = Readonly<{
  id: InboxNoteId
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  userId: UserId
  text: string
  createdAt: Date
}>

/** Detail view includes joined source data. */
export type InboxItemDetail = Readonly<{
  item: InboxItem
  // Review-specific (null for feedback)
  reviewText: string | null
  /** Google's machine translation of `reviewText`; null when none was served. */
  reviewTranslatedText: string | null
  reviewerProfilePhotoUrl: string | null
  /** BQC-1.2: typed eligibility outcome of the authorized review read. */
  reviewContentStatus: 'available' | 'expired' | 'not_found' | null
  /**
   * The guest's star rating, carried from the SAME `ReviewSnippet` that feeds
   * `reviewText` / `reviewTranslatedText` / `reviewerProfilePhotoUrl` above
   * (`review-lookup.port.ts:18`), and therefore governed by the same rule:
   * `null` for `expired` and `not_found`. A review whose content we are no
   * longer eligible to serve may not assert a rating either — the number is
   * provider-owned content exactly like the words are (BQC-1.2).
   *
   * This is NOT `item.rating`, and `item.rating` is no fallback for it. The
   * projection NULLs the row's own column on review projection and on source
   * transition (`inbox-command-store.ts:936`, `:1416` — "rating/snippet/
   * reviewer name stay with Review"), and the read path is stricter still:
   * `inboxItemFromRow` sets `rating: null` for EVERY row, feedback included
   * (`inbox.mapper.ts:37`, "Legacy column values must not be served"), and
   * `findDetailById` never writes it back. So `detail.item.rating` is null for
   * both sources — which is why the detail pane could never draw stars. Only
   * the LIST projection re-populates `rating`, from the same eligible lookup
   * (`inbox.repository.ts:433`). Feedback's number has its own field
   * (`feedbackRatingValue` below); `reviewRating` is null for feedback.
   *
   * Optional rather than required ONLY because hand-built detail fixtures
   * predate the field (9 literal sites, 7 of them `src/components/inbox`
   * stories). Every producer sets it — `inbox.repository.ts` `findDetailById`
   * on both branches, `in-memory-inbox-repo.ts` on both — and
   * `getInboxItemDetail` coerces a missing one to `null`, so the payload a
   * client reads always carries the key with a `number | null` value. Tighten
   * to required once those fixtures name it.
   */
  reviewRating?: number | null
  // Feedback-specific (null for reviews)
  feedbackComment: string | null
  feedbackRatingValue: number | null
}>
