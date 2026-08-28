/**
 * Inbox-owned boundary for Review's current Google-reply observation.
 *
 * The durable event is only a wake-up hint. Review must hold its observation
 * fence while `apply` commits the Inbox-owned mutation and receipt. The
 * callback shape makes that lifetime explicit without exposing Review tables,
 * Drizzle transactions, or provider-controlled content to Inbox.
 */

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

export type CurrentReplyObservationPermit = Readonly<{
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
  reviewSourceContentState: 'active' | 'source_expired' | 'provider_deleted'
  responseTargetEligibility: 'measured' | 'historical_onboarding' | 'legacy_unknown'
  responseTargetStartAt: Date | null
}>

export type ReplyObservationAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type ReplyObservationAuthorityPort = Readonly<{
  withExactCurrent<T>(
    expectation: ReplyObservationExpectation,
    apply: (permit: CurrentReplyObservationPermit) => Promise<T>,
  ): Promise<ReplyObservationAuthorityResult<T>>
}>
