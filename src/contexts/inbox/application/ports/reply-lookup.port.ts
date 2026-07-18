// Inbox context — reply lookup port for cross-context data access.
// Per architecture: Context A defines a port interface in its own application/ports/.
// Composition root wires Context B's public API as the port implementation.
// Mirrors review-lookup.port.ts: a self-contained DTO that does NOT import
// review context's internal types (ADR 0008).

import type { OrganizationId, ReplyId, ReviewId, UserId } from '#/shared/domain/ids'

// Self-contained copies of the review ReplyStatus / ReplySource unions.
// Kept in sync with src/contexts/review/domain/types.ts so ReplyView is
// structurally identical to review's Reply (= the client's ReplyData) without
// importing it — decoupling is the ADR-0008-accepted cost of context isolation.
export type ReplyStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'publish_failed'

export type ReplySource = 'google_sync' | 'internal'

/** Lightweight DTO — mirrors review's Reply shape without importing it.
 *  Structurally identical to `Awaited<ReturnType<typeof getReplyFn>>` so the
 *  client needs no mapper. */
export type ReplyView = Readonly<{
  id: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  status: ReplyStatus
  source: ReplySource
  createdBy: UserId | null
  approvedBy: UserId | null
  rejectedBy: UserId | null
  rejectionReason: string | null
  aiGenerated: boolean
  submittedAt: Date | null
  approvedAt: Date | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}>

export type ReplyLookupPort = Readonly<{
  /** Returns the staff-authored (internal) reply for a review, or null.
   *  Mirrors review context's getReply semantics (findInternalByReviewId). */
  getReplyByReviewId(id: ReviewId, orgId: OrganizationId): Promise<ReplyView | null>
  /**
   * BQC-3.4: earliest reply milestones per review (any source — internal
   * and google_sync), for projection rebuild. Keyed by reviewId; reviews
   * with no replies are absent from the map.
   */
  getReplyMilestonesByReviewIds(
    ids: ReadonlyArray<ReviewId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<string, ReplyMilestones>>
}>

/** Earliest reply timestamps for a review — rebuild stamps these on items. */
export type ReplyMilestones = Readonly<{
  firstSubmittedAt: Date | null
  firstPublishedAt: Date | null
}>
