/**
 * Public Review authority for an identifier-only Google-reply observation.
 *
 * Implementations retain the Review observation fence until `apply` resolves.
 * A consumer can therefore commit its own transaction while the exact Review
 * head is stable, without receiving Review's transaction or table contracts.
 */

export type ReviewReplyObservationExpectation = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  observationRevision: number
  sourceEpoch: number
  materialReviewRevision: number
  change: 'added' | 'edited' | 'deleted' | 'unchanged'
  resolution: 'confirmed_on_google' | 'external_current_live' | 'diverged' | 'absent'
  provenance: 'repkey_confirmed' | 'external_or_unknown' | 'none'
  matchedReplyId: string | null
  matchedPublicationCycle: number | null
  occurredAt: Date
}>

export type ReviewCurrentReplyObservationPermit = Readonly<{
  authority: 'review.current-google-reply-observation.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  observationRevision: number
  sourceEpoch: number
  materialReviewRevision: number
  state: 'live' | 'absent'
  change: 'added' | 'edited' | 'deleted' | 'unchanged'
  resolution: 'confirmed_on_google' | 'external_current_live' | 'diverged' | 'absent'
  provenance: 'repkey_confirmed' | 'external_or_unknown' | 'none'
  matchedReplyId: string | null
  matchedPublicationCycle: number | null
  observedAt: Date
}>

export type ReviewReplyObservationAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type ReviewReplyObservationAuthority = Readonly<{
  withExactCurrent<T>(
    expectation: ReviewReplyObservationExpectation,
    apply: (permit: ReviewCurrentReplyObservationPermit) => Promise<T>,
  ): Promise<ReviewReplyObservationAuthorityResult<T>>
}>
