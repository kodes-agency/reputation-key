// Inbox context — reply lookup port for cross-context data access.
// Per architecture: Context A defines a port interface in its own application/ports/.
// Composition root wires Context B's public API as the port implementation.
// Mirrors review-lookup.port.ts: a self-contained DTO that does NOT import
// review context's internal types (ADR 0008).

import type { OrganizationId, ReplyId, ReviewId, UserId } from '#/shared/domain/ids'
import type {
  InboxItemReplyState,
  ReplyPublicationFailureClass,
  ReplyPublicationState,
  ReplyStatus,
} from '../../domain/types'

// Self-contained copy of the review ReplySource union. ReplyView remains
// structurally identical to review's Reply without importing that context.
export type ReplySource = 'google_sync' | 'internal'

/** Lightweight DTO — mirrors review's Reply shape without importing it.
 *  Structurally identical to `Awaited<ReturnType<typeof getReplyFn>>` so the
 *  client needs no mapper. */
export type ReplyView = Readonly<{
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

export type ReplyLookupPort = Readonly<{
  /** Returns the EFFECTIVE reply for a review: the internal reply when present,
   *  otherwise the google_sync mirror (a reply published via the GBP UI or
   *  synced in). The inbox detail needs this — without it, mirror-only replies
   *  are invisible and the UI renders a compose box over an existing reply. */
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
}>

/** Earliest reply timestamps for a review — rebuild stamps these on items. */
export type ReplyMilestones = Readonly<{
  firstSubmittedAt: Date | null
  firstPublishedAt: Date | null
}>
