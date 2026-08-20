// Notification context — port for resolving inbox-item facts (ADR 0022).
// Self-contained DTOs: returns branded ids and content-free facts, exposes no
// inbox internals (mirrors the UserLookupPort convention, ADR 0008).
import type { ReviewId, OrganizationId, InboxItemId } from '#/shared/domain/ids'

/**
 * The render facts a notification needs about an inbox item (ADR 0046 r.8).
 *
 * Content-free by construction: the item's snippet, reviewer name, and media
 * are deliberately NOT here and must never be added — `rating` is a numeric
 * fact, `propertyName` is tenant-authored, and `createdAt` only yields an age.
 * The events themselves carry ids only, which is why this seam exists.
 */
export type InboxItemFacts = Readonly<{
  propertyId: string
  /** Tenant-authored property name. Null when the property row is gone. */
  propertyName: string | null
  /** 1-5 stars as reported by the source, or null for unrated feedback. */
  rating: number | null
  /** 'review' (Google-sourced) or 'feedback' (portal-sourced). */
  sourceType: string
  /** When the item entered the inbox — the clock the waiting age is measured from. */
  createdAt: Date
}>

export type InboxItemLookupPort = Readonly<{
  /** Resolve the inbox-item id for a review (sourceType=review, sourceId=reviewId).
   *  Null when the review's inbox item has been hard-deleted. */
  findInboxItemByReviewId(
    reviewId: ReviewId,
    orgId: OrganizationId,
  ): Promise<InboxItemId | null>

  /** Render facts for one inbox item. Null when the item is gone. */
  findInboxItemFacts(
    inboxItemId: InboxItemId,
    orgId: OrganizationId,
  ): Promise<InboxItemFacts | null>
}>
