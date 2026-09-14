// Inbox context — reply lookup adapter
// Implements ReplyLookupPort by delegating to the Review context's repository
// methods, injected via deps.
// Cross-context coupling is encapsulated here in the infrastructure layer where
// it's acceptable; no review-context module is imported (ADR 0008). Mirrors
// review-lookup.adapter.ts.

import type {
  GoogleObservedReplyView,
  ReplyLookupPort,
  ReplyEntityView,
} from '../../application/ports/reply-lookup.port'
import type { ReplyLookupSource } from '../../application/ports/lookup-sources.port'
import type { InboxItemReplyState } from '../../domain/types'

type ObservedGoogleReply = Awaited<
  ReturnType<ReplyLookupSource['getCurrentGoogleReplyByReviewId']>
>

function observedReplyView(
  observed: NonNullable<ObservedGoogleReply>,
): GoogleObservedReplyView {
  const publishedAt = observed.providerUpdatedAt ?? observed.observedAt
  return {
    kind: 'google_observation',
    id: observed.id,
    reviewId: observed.reviewId,
    organizationId: observed.organizationId,
    text: observed.text,
    status: 'published' as const,
    source: 'google_sync' as const,
    publishedAt,
    updatedAt: observed.observedAt,
  }
}

function replyEntityView(
  reply: Awaited<ReturnType<ReplyLookupSource['findByReviewId']>>[number],
): ReplyEntityView {
  return { kind: 'reply', ...reply }
}

export const createReplyLookupAdapter = (deps: ReplyLookupSource): ReplyLookupPort => ({
  getEffectiveReplyByReviewId: async (id, orgId) => {
    const [replies, observed] = await Promise.all([
      deps.findByReviewId(id, orgId),
      deps.getCurrentGoogleReplyByReviewId(id, orgId),
    ])
    const internal = replies.find((reply) => reply.source === 'internal')
    // A matching observation proves the internal reply is the current Google
    // reply, so retain its RepKey provenance and editable lifecycle. Any other
    // current live observation is provider-owned truth and outranks a stale or
    // superseded internal row.
    if (observed) {
      if (internal && observed.matchedReplyId === internal.id) {
        return replyEntityView(internal)
      }
      return observedReplyView(observed)
    }
    // Legacy fallback for rows that predate governed reply observations.
    const reply =
      internal ?? replies.find((candidate) => candidate.source === 'google_sync')
    return reply ? replyEntityView(reply) : null
  },
  getReplyMilestonesByReviewIds: async (ids, orgId) => {
    const rows = await deps.findMilestonesByReviewIds(ids, orgId)
    return new Map(rows.map(({ reviewId, ...milestones }) => [reviewId, milestones]))
  },
  getReplyStatesByReviewIds: async (ids, orgId) => {
    const rows = await deps.findStatesByReviewIds(ids, orgId)
    const states = new Map<string, InboxItemReplyState>()
    for (const { reviewId, source, ...state } of rows) {
      if (!states.has(reviewId) || source === 'internal') {
        states.set(reviewId, state)
      }
    }
    return states
  },
  findReviewIdsByReplyStage: async (orgId, propertyIds) => {
    const rows = await deps.findReviewIdsByReplyStage(orgId, propertyIds)
    const effective = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (!effective.has(row.reviewId) || row.source === 'internal') {
        effective.set(row.reviewId, row)
      }
    }

    const awaiting = []
    const waiting = []
    for (const row of effective.values()) {
      if (row.stage === 'awaiting') awaiting.push(row.reviewId)
      else if (row.stage === 'waiting') waiting.push(row.reviewId)
    }
    return { awaiting, waiting }
  },
})
