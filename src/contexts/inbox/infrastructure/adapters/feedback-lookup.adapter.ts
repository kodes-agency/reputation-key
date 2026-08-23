// Inbox context — feedback lookup adapter
// Implements FeedbackLookupPort by delegating to the Guest context's repository.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.
//
// Reads the CURRENT guest_responses aggregate first and only then the legacy
// feedback/ratings pair. The live guest form writes the aggregate, and
// `guest.feedback.submitted` now carries the aggregate row id — without this
// order every new feedback inbox item would render with a null comment and a
// null rating, because the legacy lookup cannot find that id.

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
    const [responseIds, legacyIds] = await Promise.all([
      deps.findEligibleResponseIds(orgId, filter),
      deps.findEligibleLegacyFeedbackIds(orgId, filter),
    ])
    return [...new Set([...responseIds, ...legacyIds])]
  },
})

async function getFeedbackSnippetsByIds(
  deps: FeedbackLookupSource,
  ids: Parameters<FeedbackLookupPort['getFeedbackSnippetsByIds']>[0],
  orgId: Parameters<FeedbackLookupPort['getFeedbackSnippetsByIds']>[1],
): ReturnType<FeedbackLookupPort['getFeedbackSnippetsByIds']> {
  const snippets = new Map<
    string,
    { comment: string | null; ratingValue: number | null }
  >()
  if (ids.length === 0) return snippets

  const current = await deps.findResponseSnippetsByIds(ids, orgId)
  for (const row of current) {
    snippets.set(row.id, { comment: row.comment, ratingValue: row.ratingValue })
  }

  const unresolved = ids.filter((id) => !snippets.has(id))
  if (unresolved.length === 0) return snippets
  const legacy = await deps.findLegacyFeedbackSnippetsByIds(unresolved, orgId)
  for (const row of legacy) {
    snippets.set(row.id, { comment: row.comment, ratingValue: row.ratingValue })
  }
  return snippets
}
