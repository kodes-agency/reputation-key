// Inbox context — reply lookup adapter
// Implements ReplyLookupPort by delegating to the Review context's repository
// methods (findInternalByReviewId / findByReviewId), injected via deps.
// Cross-context coupling is encapsulated here in the infrastructure layer where
// it's acceptable; no review-context module is imported (ADR 0008). Mirrors
// review-lookup.adapter.ts.

import type {
  ReplyLookupPort,
  ReplyMilestones,
  ReplyView,
} from '../../application/ports/reply-lookup.port'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

/** Earliest non-null timestamp across the given reply views. */
const earliest = (
  replies: ReadonlyArray<ReplyView>,
  pick: (reply: ReplyView) => Date | null,
): Date | null => {
  let best: Date | null = null
  for (const reply of replies) {
    const at = pick(reply)
    if (at && (!best || at.getTime() < best.getTime())) best = at
  }
  return best
}

export const createReplyLookupAdapter = (deps: {
  /** Returns the internal reply for a review. The review repo's
   *  findInternalByReviewId returns its own Reply type, which is structurally
   *  identical to ReplyView — so no mapping is needed. */
  findInternalByReviewId: (
    id: ReviewId,
    orgId: OrganizationId,
  ) => Promise<ReplyView | null>
  /** Returns ALL replies for a review (internal + google_sync). Used by the
   *  BQC-3.4 rebuild to derive first-submitted/published milestones. */
  findByReviewId: (
    id: ReviewId,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<ReplyView>>
}): ReplyLookupPort => ({
  getReplyByReviewId: (id, orgId) => deps.findInternalByReviewId(id, orgId),
  getEffectiveReplyByReviewId: async (id, orgId) => {
    // Internal first; the google_sync mirror only when no internal reply exists.
    const replies = await deps.findByReviewId(id, orgId)
    return (
      replies.find((r) => r.source === 'internal') ??
      replies.find((r) => r.source === 'google_sync') ??
      null
    )
  },
  getReplyMilestonesByReviewIds: async (ids, orgId) => {
    // Per-review lookups, bounded by the caller's rebuild batch size.
    const map = new Map<string, ReplyMilestones>()
    for (const id of ids) {
      const replies = await deps.findByReviewId(id, orgId)
      if (replies.length === 0) continue
      map.set(id as string, {
        firstSubmittedAt: earliest(replies, (r) => r.submittedAt),
        firstPublishedAt: earliest(replies, (r) => r.publishedAt),
      })
    }
    return map
  },
})
