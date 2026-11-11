// Inbox context — feedback lookup adapter
// Implements FeedbackLookupPort by delegating to the Guest context's snippet reads
// of the guest_responses aggregate, whose row id `guest.feedback.submitted` carries.

import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { FeedbackLookupSource } from '../../application/ports/lookup-sources.port'

export const createFeedbackLookupAdapter = (
  deps: FeedbackLookupSource,
): FeedbackLookupPort => ({
  getFeedbackSnippetById: async (id, orgId) => {
    const snippets = await getFeedbackSnippetsByIds(deps, [id], orgId)
    return snippets.get(id) ?? null
  },
  getFeedbackSnippetsByIds: (ids, orgId) => getFeedbackSnippetsByIds(deps, ids, orgId),
  findEligibleFeedbackIds: async (orgId, filter) => {
    return deps.findEligibleResponseIds(orgId, filter)
  },
})

async function getFeedbackSnippetsByIds(
  deps: FeedbackLookupSource,
  ids: Parameters<FeedbackLookupPort['getFeedbackSnippetsByIds']>[0],
  orgId: Parameters<FeedbackLookupPort['getFeedbackSnippetsByIds']>[1],
): ReturnType<FeedbackLookupPort['getFeedbackSnippetsByIds']> {
  const snippets = new Map<
    string,
    {
      comment: string | null
      ratingValue: number | null
      responseRevision: number | null
    }
  >()
  if (ids.length === 0) return snippets

  const current = await deps.findResponseSnippetsByIds(ids, orgId)
  for (const row of current) {
    snippets.set(row.id, {
      comment: row.comment,
      ratingValue: row.ratingValue,
      responseRevision: row.feedbackSubmissionRevision ?? null,
    })
  }

  return snippets
}
