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
import type { ReplyLookupSource } from '../../application/ports/lookup-sources.port'

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

export const createReplyLookupAdapter = (deps: ReplyLookupSource): ReplyLookupPort => ({
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
