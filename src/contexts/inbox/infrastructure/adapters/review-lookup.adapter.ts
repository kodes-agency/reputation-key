// Inbox context — review lookup adapter
// Implements ReviewLookupPort by delegating to the Review context's repository.
// Cross-context SQL is encapsulated here in the infrastructure layer where it's acceptable.
//
// BQC-1.2: enforces source eligibility on every read (ADR 0031). Content is
// available only when a successful-fetch clock exists and has not passed
// (contentExpiresAt > now). Clock-less rows fail closed — they are the
// unmanaged legacy/sim rows flagged in the BQC-1.1 inventory.

import type {
  ReviewContentFilter,
  ReviewLookupPort,
  ReviewSnippet,
  ReviewSnippetResult,
} from '../../application/ports/review-lookup.port'
import type { OrganizationId, ReviewId } from '#/shared/domain/ids'
import { isContentEligibleForRead } from '#/contexts/review/application/source-content-lifecycle'

/**
 * Minimal structural type — we only need content fields + the fetch clock
 * from the review row. Avoids importing the full Review type cross-context.
 */
type ReviewSnippetRow = Readonly<{
  id: string
  reviewerName: string | null
  text: string | null
  reviewerProfilePhotoUrl: string | null
  rating: number | null
  contentExpiresAt: Date | null
}>

const toSnippet = (
  r: Omit<ReviewSnippetRow, 'id' | 'contentExpiresAt'>,
): ReviewSnippet => ({
  reviewerName: r.reviewerName,
  text: r.text,
  reviewerProfilePhotoUrl: r.reviewerProfilePhotoUrl,
  rating: r.rating,
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
  findReviewIdsByContentFilter: (
    orgId: OrganizationId,
    filter: ReviewContentFilter,
    now: Date,
  ) => Promise<ReadonlyArray<string>>
  clock: () => Date
}): ReviewLookupPort => ({
  getReviewSnippetById: async (id, orgId) => {
    const r = await deps.findReviewById(id, orgId)
    if (!r) return { status: 'not_found' } satisfies ReviewSnippetResult
    if (!isContentEligibleForRead(r.contentExpiresAt, deps.clock())) {
      return { status: 'expired' } satisfies ReviewSnippetResult
    }
    return { status: 'available', snippet: toSnippet(r) } satisfies ReviewSnippetResult
  },

  getReviewSnippetsByIds: async (ids, orgId) => {
    const map = new Map<string, ReviewSnippet>()
    if (ids.length === 0) return map
    const now = deps.clock()
    const rows = await deps.findReviewsByIds(ids, orgId)
    for (const r of rows) {
      if (!isContentEligibleForRead(r.contentExpiresAt, now)) continue
      map.set(r.id, toSnippet(r))
    }
    return map
  },

  findEligibleReviewIds: async (orgId, filter) => {
    return deps.findReviewIdsByContentFilter(orgId, filter, deps.clock())
  },
})
