// Inbox context — review lookup port for cross-context data access.
// Per architecture: Context A defines a port interface in its own application/ports/.
// Composition root wires Context B's public API as the port implementation.
//
// BQC-1.2: this is the authorized Review lookup for inbox surfaces. It
// enforces source eligibility — expired or clock-less content is never
// served (ADR 0031: only a successful authorized fetch advances the clock).

import type { OrganizationId, ReviewId } from '#/shared/domain/ids'

/** Lightweight DTO — does not expose review context's internal types. */
export type ReviewSnippet = Readonly<{
  reviewerName: string | null
  text: string | null
  reviewerProfilePhotoUrl: string | null
  rating: number | null
}>

/**
 * Typed eligibility outcome. UI distinguishes available / expired /
 * not_found without being served stale content.
 */
export type ReviewSnippetResult =
  | Readonly<{ status: 'available'; snippet: ReviewSnippet }>
  | Readonly<{ status: 'expired' }>
  | Readonly<{ status: 'not_found' }>

/** Review-owned content filters for the inbox list (rating range, text search). */
export type ReviewContentFilter = Readonly<{
  ratingMin?: number
  ratingMax?: number
  textQuery?: string
}>

export type ReviewLookupPort = Readonly<{
  /** Single eligible read — typed unavailable outcome, never stale fields. */
  getReviewSnippetById(id: ReviewId, orgId: OrganizationId): Promise<ReviewSnippetResult>
  /** Batch read — only eligible snippets are returned (absence = unavailable). */
  getReviewSnippetsByIds(
    ids: ReadonlyArray<ReviewId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<string, ReviewSnippet>>
  /** Review-owned eligible id query for inbox list filters (no cross-context JOINs). */
  findEligibleReviewIds(
    orgId: OrganizationId,
    filter: ReviewContentFilter,
  ): Promise<ReadonlyArray<string>>
}>
