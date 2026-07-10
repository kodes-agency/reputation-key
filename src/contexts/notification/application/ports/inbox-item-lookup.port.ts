// Notification context — port for resolving an inbox item from a review (ADR 0022).
// Self-contained DTO: returns a branded InboxItemId string, exposes no inbox
// internals (mirrors the UserLookupPort / ReviewSnippet convention, ADR 0008).
import type { ReviewId, OrganizationId, InboxItemId } from '#/shared/domain/ids'

export type InboxItemLookupPort = Readonly<{
  /** Resolve the inbox-item id for a review (sourceType=review, sourceId=reviewId).
   *  Null when the review's inbox item has been hard-deleted. */
  findInboxItemByReviewId(
    reviewId: ReviewId,
    orgId: OrganizationId,
  ): Promise<InboxItemId | null>
}>
