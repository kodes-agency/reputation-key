// Inbox context — reply lookup adapter
// Implements ReplyLookupPort by delegating to the Review context's repository
// method (findInternalByReviewId), injected via deps.
// Cross-context coupling is encapsulated here in the infrastructure layer where
// it's acceptable; no review-context module is imported (ADR 0008). Mirrors
// review-lookup.adapter.ts.

import type {
  ReplyLookupPort,
  ReplyView,
} from '../../application/ports/reply-lookup.port'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

export const createReplyLookupAdapter = (deps: {
  /** Returns the internal reply for a review. The review repo's
   *  findInternalByReviewId returns its own Reply type, which is structurally
   *  identical to ReplyView — so no mapping is needed. */
  findInternalByReviewId: (
    id: ReviewId,
    orgId: OrganizationId,
  ) => Promise<ReplyView | null>
}): ReplyLookupPort => ({
  getReplyByReviewId: (id, orgId) => deps.findInternalByReviewId(id, orgId),
})
