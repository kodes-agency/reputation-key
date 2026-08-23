// Inbox context — feedback lookup port for cross-context data access.
// Per architecture: Context A defines a port interface in its own application/ports/.
// Composition root wires Context B's public API as the port implementation.

import type { FeedbackId, OrganizationId } from '#/shared/domain/ids'

/** Lightweight DTO — does not expose guest context's internal types. */
export type FeedbackSnippet = Readonly<{
  comment: string | null
  ratingValue: number | null
}>

export type FeedbackContentFilter = Readonly<{
  ratingMin?: number
  ratingMax?: number
  textQuery?: string
}>

export type FeedbackLookupPort = Readonly<{
  getFeedbackSnippetById(
    id: FeedbackId,
    orgId: OrganizationId,
  ): Promise<FeedbackSnippet | null>
  getFeedbackSnippetsByIds(
    ids: ReadonlyArray<FeedbackId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<string, FeedbackSnippet>>
  findEligibleFeedbackIds(
    orgId: OrganizationId,
    filter: FeedbackContentFilter,
  ): Promise<ReadonlyArray<FeedbackId>>
}>
