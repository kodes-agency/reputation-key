// Inbox context — reply lookup adapter
// Implements ReplyLookupPort by delegating to the Review context's repository
// methods, injected via deps.
// Cross-context coupling is encapsulated here in the infrastructure layer where
// it's acceptable; no review-context module is imported (ADR 0008). Mirrors
// review-lookup.adapter.ts.

import type { ReplyLookupPort } from '../../application/ports/reply-lookup.port'
import type { ReplyLookupSource } from '../../application/ports/lookup-sources.port'

export const createReplyLookupAdapter = (deps: ReplyLookupSource): ReplyLookupPort => ({
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
    const rows = await deps.findMilestonesByReviewIds(ids, orgId)
    return new Map(rows.map(({ reviewId, ...milestones }) => [reviewId, milestones]))
  },
})
