// Inbox context — reply lookup port for cross-context data access.
// Per architecture: Context A defines a port interface in its own application/ports/.
// Composition root wires Context B's public API as the port implementation.
// Mirrors review-lookup.port.ts: a self-contained DTO that does NOT import
// review context's internal types (ADR 0008).

import type {
  OrganizationId,
  PropertyId,
  ReplyId,
  ReviewId,
  UserId,
} from '#/shared/domain/ids'
import type {
  InboxItemReplyState,
  ReplyPublicationFailureClass,
  ReplyPublicationState,
  ReplyStatus,
} from '../../domain/types'
import type { InboxReplyStages } from '../inbox-queues'

// Self-contained copy of the review ReplySource union. ReplyEntityView remains
// structurally identical to review's Reply apart from its Inbox-owned
// discriminant, without importing that context.
export type ReplySource = 'google_sync' | 'internal'

/** Review Reply projected into Inbox's presentation contract. */
export type ReplyEntityView = Readonly<{
  /** Present on adapter results; optional for write-through Reply cache patches. */
  kind?: 'reply'
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  replyLanguageTag?: string | null
  templateId: string | null
  templateVersion: number | null
  status: ReplyStatus
  source: ReplySource
  createdBy: UserId | null
  approvedBy: UserId | null
  rejectedBy: UserId | null
  rejectionReason: string | null
  aiGenerated: boolean
  /** Monotonic durable reply lifecycle revision. */
  stateRevision: number
  submittedAt: Date | null
  approvedAt: Date | null
  publishedAt: Date | null
  // BQC-3.8: publication state machine overlay (migration 0015).
  publicationState: ReplyPublicationState | null
  publicationAttempts: number
  /** Exact durable publication authorization cycle; zero before first authorization. */
  publicationCycle: number
  publicationLastErrorClass: ReplyPublicationFailureClass | null
  reconcileDueAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

/**
 * Provider-owned current reply content. This is deliberately not padded into
 * a Review Reply: an observation has no Reply id, actor, approval lifecycle,
 * publication attempt count, or edit authority.
 */
export type GoogleObservedReplyView = Readonly<{
  kind: 'google_observation'
  id: string
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  status: 'published'
  source: 'google_sync'
  publishedAt: Date
  updatedAt: Date
}>

/** The effective public-reply message Inbox may present. */
export type ReplyView = ReplyEntityView | GoogleObservedReplyView

export type ReplyLookupPort = Readonly<{
  /** Returns the EFFECTIVE reply for a review, in this order: the internal
   *  reply when a live observation CONFIRMS it (`matchedReplyId`); the
   *  observation when one is live and matches nothing; otherwise the newest
   *  internal reply of ANY status — a `draft` included, which is what seeds the
   *  compose box — and finally a legacy `google_sync` mirror row.
   *
   *  The "any status" step is load-bearing and was previously described here as
   *  "a confirmed internal reply": narrowing it to `published` would delete the
   *  compose seed for every saved, unpublished draft.
   *
   *  Without provider truth, the UI can render a compose box over a reply that
   *  already exists on Google. */
  getEffectiveReplyByReviewId(
    id: ReviewId,
    orgId: OrganizationId,
  ): Promise<ReplyView | null>
  /**
   * BQC-3.4: earliest reply milestones per review (any source — internal
   * and google_sync), for projection rebuild. Keyed by reviewId; reviews
   * with no replies are absent from the map.
   */
  getReplyMilestonesByReviewIds(
    ids: ReadonlyArray<ReviewId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<string, ReplyMilestones>>
  /**
   * Governed, content-free effective reply state for a bounded review set.
   * Reviews with no reply are absent from the map.
   */
  getReplyStatesByReviewIds(
    ids: ReadonlyArray<ReviewId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<string, InboxItemReplyState>>
  /** Effective reply-stage ids for queue filtering, content-free and tenant-scoped. */
  findReviewIdsByReplyStage(
    orgId: OrganizationId,
    propertyIds?: ReadonlyArray<PropertyId>,
  ): Promise<InboxReplyStages>
}>

/** Earliest reply timestamps for a review — rebuild stamps these on items. */
export type ReplyMilestones = Readonly<{
  firstSubmittedAt: Date | null
  firstPublishedAt: Date | null
}>
