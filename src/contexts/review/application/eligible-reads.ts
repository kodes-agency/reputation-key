// Review context — eligible reads (BQC-1.4).
//
// The governed query interface for review content: every cross-context
// serving read crosses this module. Eligibility rule is
// isContentEligibleForRead (ADR 0031): a successful-fetch clock exists and
// has not passed; clock-less rows fail closed. Expired/unresolved reads
// return a typed unavailable outcome — never stale fields.
//
// Operations paths (sync, refresh, purge, reply publish) read rows directly
// through the repository by design — they perform authorized source
// operations, not content serving.

import type { ReviewRepository } from './ports/review.repository'
import type { GoogleReplyObservationLookup } from './ports/google-reply-observation-store.port'
import type { OrganizationId, ReplyId, ReviewId } from '#/shared/domain/ids'
import { isContentEligibleForRead } from './source-content-lifecycle'

/** Content DTO for serving reads — no review-context internals. */
export type EligibleReviewSnippet = Readonly<{
  reviewerName: string | null
  text: string | null
  /** Provider machine translation; `text` holds the guest's original words. */
  translatedText: string | null
  reviewerProfilePhotoUrl: string | null
  rating: number | null
  languageCode: string | null
}>

/** Typed eligibility outcome — UI distinguishes without stale content. */
export type EligibleReviewSnippetResult =
  | Readonly<{ status: 'available'; snippet: EligibleReviewSnippet }>
  | Readonly<{ status: 'expired' }>
  | Readonly<{ status: 'not_found' }>

/** Review-owned content filters for list surfaces (rating range, text search). */
export type EligibleReviewContentFilter = Readonly<{
  ratingMin?: number
  ratingMax?: number
  textQuery?: string
}>

/** Current Google reply content that remains eligible to serve. */
export type EligibleGoogleReply = Readonly<{
  id: string
  reviewId: ReviewId
  organizationId: OrganizationId
  text: string
  observationRevision: number
  provenance: 'repkey_confirmed' | 'external_or_unknown'
  matchedReplyId: ReplyId | null
  providerUpdatedAt: Date | null
  observedAt: Date
}>

export type EligibleReviewReads = Readonly<{
  /** Single eligible read — typed unavailable outcome. */
  getReviewSnippetById(
    id: ReviewId,
    orgId: OrganizationId,
  ): Promise<EligibleReviewSnippetResult>
  /** Batch read — only eligible snippets are returned (absence = unavailable). */
  getReviewSnippetsByIds(
    ids: ReadonlyArray<ReviewId>,
    orgId: OrganizationId,
  ): Promise<ReadonlyMap<string, EligibleReviewSnippet>>
  /** Eligible id query for list filters (eligibility predicate in SQL). */
  findEligibleReviewIds(
    orgId: OrganizationId,
    filter: EligibleReviewContentFilter,
  ): Promise<ReadonlyArray<string>>
  /** Rating for aggregates at consume time — null when expired/missing. */
  getEligibleRatingById(id: ReviewId, orgId: OrganizationId): Promise<number | null>
}>

export type EligibleGoogleReplyReads = Readonly<{
  /** Current live Google reply, or null when absent, expired, or erased. */
  getCurrentGoogleReplyByReviewId(
    id: ReviewId,
    orgId: OrganizationId,
  ): Promise<EligibleGoogleReply | null>
}>

export type EligibleReads = EligibleReviewReads & EligibleGoogleReplyReads

export const createEligibleReads = (deps: {
  reviewRepo: ReviewRepository
  clock: () => Date
}): EligibleReviewReads => ({
  getReviewSnippetById: async (id, orgId) => {
    const r = await deps.reviewRepo.findById(id, orgId)
    if (!r) return { status: 'not_found' } satisfies EligibleReviewSnippetResult
    if (!isContentEligibleForRead(r.contentExpiresAt, deps.clock())) {
      return { status: 'expired' } satisfies EligibleReviewSnippetResult
    }
    return {
      status: 'available',
      snippet: {
        reviewerName: r.reviewerName,
        text: r.text,
        translatedText: r.translatedText,
        reviewerProfilePhotoUrl: r.reviewerProfilePhotoUrl,
        rating: r.rating,
        languageCode: r.languageCode,
      },
    } satisfies EligibleReviewSnippetResult
  },

  getReviewSnippetsByIds: async (ids, orgId) => {
    const map = new Map<string, EligibleReviewSnippet>()
    if (ids.length === 0) return map
    const now = deps.clock()
    const rows = await deps.reviewRepo.findByIds(ids, orgId)
    for (const r of rows) {
      if (!isContentEligibleForRead(r.contentExpiresAt, now)) continue
      map.set(r.id as string, {
        reviewerName: r.reviewerName,
        text: r.text,
        translatedText: r.translatedText,
        reviewerProfilePhotoUrl: r.reviewerProfilePhotoUrl,
        rating: r.rating,
        languageCode: r.languageCode,
      })
    }
    return map
  },

  findEligibleReviewIds: async (orgId, filter) => {
    return deps.reviewRepo.findIdsByContentFilter(orgId, filter, deps.clock())
  },

  getEligibleRatingById: async (id, orgId) => {
    const r = await deps.reviewRepo.findById(id, orgId)
    if (!r || !isContentEligibleForRead(r.contentExpiresAt, deps.clock())) return null
    return r.rating
  },
})

export const createEligibleGoogleReplyReads = (deps: {
  googleReplyObservations: GoogleReplyObservationLookup
  clock: () => Date
}): EligibleGoogleReplyReads => ({
  getCurrentGoogleReplyByReviewId: async (id, orgId) => {
    const current = await deps.googleReplyObservations.findCurrentByReviewId(id, orgId)
    if (
      !current ||
      current.state !== 'live' ||
      current.provenance === 'none' ||
      current.normalizedText === null ||
      current.contentState !== 'active' ||
      !isContentEligibleForRead(current.contentExpiresAt, deps.clock())
    ) {
      return null
    }
    return {
      id: current.id,
      reviewId: current.reviewId,
      organizationId: current.organizationId,
      text: current.normalizedText,
      observationRevision: current.observationRevision,
      provenance: current.provenance,
      matchedReplyId: current.matchedReplyId,
      providerUpdatedAt: current.providerUpdatedAt,
      observedAt: current.observedAt,
    }
  },
})
