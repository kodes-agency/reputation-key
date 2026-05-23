// Inbox context — review lookup port for cross-context data access.
// Per architecture: Context A defines a port interface in its own application/ports/.
// Composition root wires Context B's public API as the port implementation.

import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

/** Lightweight DTO — does not expose review context's internal types. */
export type ReviewSnippet = Readonly<{
  reviewerName: string | null
  text: string | null
  reviewerProfilePhotoUrl: string | null
}>

export type ReviewLookupPort = Readonly<{
  getReviewSnippetById(id: ReviewId, orgId: OrganizationId): Promise<ReviewSnippet | null>
}>
