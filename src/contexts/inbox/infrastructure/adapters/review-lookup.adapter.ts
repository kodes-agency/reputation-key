// Inbox context — review lookup adapter
// Implements ReviewLookupPort by delegating to the Review context's repository.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.

import type {
  ReviewLookupPort,
  ReviewSnippet,
} from '../../application/ports/review-lookup.port'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

/**
 * Minimal structural type — we only need findById/findByIds from the review repo.
 * Avoids importing the full ReviewRepository type from another context.
 */
type ReviewSnippetRow = Readonly<{
  id: string
  reviewerName: string | null
  text: string | null
  reviewerProfilePhotoUrl: string | null
}>

const toSnippet = (r: ReviewSnippetRow): ReviewSnippet => ({
  reviewerName: r.reviewerName,
  text: r.text,
  reviewerProfilePhotoUrl: r.reviewerProfilePhotoUrl,
})

export const createReviewLookupAdapter = (deps: {
  findReviewById: (
    id: ReviewId,
    orgId: OrganizationId,
  ) => Promise<Omit<ReviewSnippetRow, 'id'> | null>
  findReviewsByIds: (
    ids: ReadonlyArray<ReviewId>,
    orgId: OrganizationId,
  ) => Promise<ReadonlyArray<ReviewSnippetRow>>
}): ReviewLookupPort => ({
  getReviewSnippetById: async (id, orgId) => {
    const r = await deps.findReviewById(id, orgId)
    if (!r) return null
    return toSnippet({ id: id as string, ...r })
  },

  getReviewSnippetsByIds: async (ids, orgId) => {
    const map = new Map<string, ReviewSnippet>()
    if (ids.length === 0) return map
    const rows = await deps.findReviewsByIds(ids, orgId)
    for (const r of rows) {
      map.set(r.id, toSnippet(r))
    }
    return map
  },
})
