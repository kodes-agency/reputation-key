// Inbox context — review source-metadata lookup port (BQC-3.4).
//
// Serves projection-owned metadata (never content): the durable
// review.updated consumer refreshes sourceDate/platform from it, and the
// rebuild use case derives canonical review-sourced inbox state from it.
// Wired at composition to the Review context's repository (ADR-0008 —
// the port is defined here, the implementation is injected).

import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

/** Projection-source metadata for one review — no content fields. */
export type ReviewSourceMeta = Readonly<{
  id: ReviewId
  propertyId: PropertyId
  platform: string
  /** The review's reviewedAt — the inbox item's canonical sourceDate. */
  sourceDate: Date
  /** Source-content expiry clock (ADR 0031); null = no successful fetch yet. */
  contentExpiresAt: Date | null
}>

export type ReviewSourceLookupPort = Readonly<{
  /** Single review's source metadata, or null when the review is gone. */
  getReviewSourceMetaById(
    id: ReviewId,
    orgId: OrganizationId,
  ): Promise<ReviewSourceMeta | null>
  /**
   * All review sources for an org (optionally one property). Used by
   * rebuildInboxProjection — a repair command whose full scan is inherently
   * org-sized; callers bound the MUTATION units, not this read.
   */
  listReviewSources(
    orgId: OrganizationId,
    propertyId?: PropertyId,
  ): Promise<ReadonlyArray<ReviewSourceMeta>>
}>
