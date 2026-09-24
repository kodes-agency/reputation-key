/**
 * Public Review authority for an identifier-only Google-reply observation.
 *
 * Implementations retain the Review observation fence until `apply` resolves.
 * A consumer can therefore commit its own transaction while the exact Review
 * head is stable, without receiving Review's transaction or table contracts.
 *
 * Inbox declares a mirror of the two shapes below in its own
 * `application/ports/reply-observation-authority.port.ts`. That repetition is
 * ADR 0008 §1 working as intended: a consumer names the boundary it depends on
 * in its own context, and this file stays Review's published contract, free to
 * gain a field for one consumer without every other consumer's layer changing
 * with it. Neither side may import the other's type.
 */

// Review's published expectation; Inbox mirrors it on its side (ADR 0008).
// fallow-ignore-next-line code-duplication
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

// Review's published permit; Inbox mirrors it on its side (ADR 0008).
// fallow-ignore-next-line code-duplication
export type ReviewCurrentReplyObservationPermit = Readonly<{
  authority: 'review.current-google-reply-observation.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  observationRevision: number
  sourceEpoch: number
  materialReviewRevision: number
  /** Immediate prior revision when Review proves this revision is only the
   * same normalized material rebound to a newer source epoch. */
  sourceEpochCarryFromMaterialReviewRevision: number | null
  state: 'live' | 'absent'
  change: 'added' | 'edited' | 'deleted' | 'unchanged'
  resolution: 'confirmed_on_google' | 'external_current_live' | 'diverged' | 'absent'
  provenance: 'repkey_confirmed' | 'external_or_unknown' | 'none'
  matchedReplyId: string | null
  matchedPublicationCycle: number | null
  observedAt: Date
  reviewSourceContentState: 'active' | 'source_expired' | 'provider_deleted'
  responseTargetEligibility: 'measured' | 'historical_onboarding' | 'legacy_unknown'
  responseTargetStartAt: Date | null
  /** The guest's star rating on this revision; null when it carries none. */
  rating: number | null
}>

export type ReviewReplyObservationAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type ReviewReplyObservationAuthority = Readonly<{
  withExactCurrent<T>(
    expectation: ReviewReplyObservationExpectation,
    apply: (permit: ReviewCurrentReplyObservationPermit) => Promise<T>,
  ): Promise<ReviewReplyObservationAuthorityResult<T>>
}>
