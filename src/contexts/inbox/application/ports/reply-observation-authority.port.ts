/**
 * Inbox-owned boundary for Review's current Google-reply observation.
 *
 * The durable event is only a wake-up hint. Review must hold its observation
 * fence while `apply` commits the Inbox-owned mutation and receipt. The
 * callback shape makes that lifetime explicit without exposing Review tables,
 * Drizzle transactions, or provider-controlled content to Inbox.
 *
 * The two shapes below deliberately mirror Review's own
 * `ReplyObservationAuthority` port (ADR 0008 §1: a consuming context declares
 * the boundary it needs in its OWN `application/ports/`, and reaches the
 * producing context only through that port). Sharing one type would make
 * Inbox's application layer import a Review type directly, which is the
 * boundary violation the ADR exists to prevent, and would let a Review-side
 * change to the permit reach Inbox without either side deciding to accept it.
 * They are expected to drift: the two comments about `rating` already do.
 */

// The fence Inbox asks Review to hold, named on Inbox's side (ADR 0008).
// fallow-ignore-next-line code-duplication
export type ReplyObservationExpectation = Readonly<{
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

// What Inbox accepts inside that fence, named on Inbox's side (ADR 0008).
// fallow-ignore-next-line code-duplication
export type CurrentReplyObservationPermit = Readonly<{
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
  /**
   * The guest's star rating on this revision. A reopen after Google dropped
   * the reply is new work on the same review, so it is measured against the
   * same clock the original cycle was.
   */
  rating: number | null
}>

export type ReplyObservationAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type ReplyObservationAuthorityPort = Readonly<{
  withExactCurrent<T>(
    expectation: ReplyObservationExpectation,
    apply: (permit: CurrentReplyObservationPermit) => Promise<T>,
  ): Promise<ReplyObservationAuthorityResult<T>>
}>
