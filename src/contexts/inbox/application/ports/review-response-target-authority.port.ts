/** Inbox-owned boundary for Review's current Google target provenance. */

export type ReviewResponseTargetExpectation = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
}>

export type CurrentReviewResponseTargetPermit = Readonly<{
  authority: 'review.current-response-target.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  materialReviewRevision: number
  eligibility: 'measured' | 'historical_onboarding' | 'legacy_unknown'
  responseTargetStartAt: Date | null
}>

export type ReviewInboxProjectionExpectation = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  eventSourceRevision: number
  eventKind: 'created' | 'updated'
}>

export type ReviewInboxProjectionRevisionPermit = Readonly<{
  authority: 'review.inbox-projection-revision.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  materialReviewRevision: number
  eligibility: 'measured' | 'historical_onboarding' | 'legacy_unknown'
  responseTargetStartAt: Date | null
  observedAt: Date
}>

export type CurrentReviewInboxProjectionPermit = Readonly<{
  authority: 'review.current-inbox-projection.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  platform: 'google'
  sourceDate: Date
  sourceContentState: 'active' | 'source_expired' | 'provider_deleted'
  sourceContentErasedAt: Date | null
  currentMaterialReviewRevision: number
  revisions: readonly [
    ReviewInboxProjectionRevisionPermit,
    ...ReviewInboxProjectionRevisionPermit[],
  ]
}>

/**
 * Inbox owns the clock for a new operational Handling Cycle, while Review owns
 * the immutable Google publication/revision provenance. Keeping those facts in
 * a discriminated anchor prevents a caller from rewriting Review's attested
 * start instant when a manager or exact provider observation opens new work.
 */
export type ReviewCycleTargetAnchor = Readonly<{
  reviewAuthority: CurrentReviewResponseTargetPermit | ReviewInboxProjectionRevisionPermit
  targetStart:
    | Readonly<{ basis: 'review_provenance' }>
    | Readonly<{ basis: 'operational_reopen'; at: Date }>
}>

export type ReviewResponseTargetAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type ReviewResponseTargetAuthorityPort = Readonly<{
  withExactCurrent<T>(
    expectation: ReviewResponseTargetExpectation,
    apply: (permit: CurrentReviewResponseTargetPermit) => Promise<T>,
  ): Promise<ReviewResponseTargetAuthorityResult<T>>
  withExactCurrentBatch<T>(
    expectations: readonly ReviewResponseTargetExpectation[],
    apply: (permits: readonly CurrentReviewResponseTargetPermit[]) => Promise<T>,
  ): Promise<ReviewResponseTargetAuthorityResult<T>>
  withInboxProjection<T>(
    expectation: ReviewInboxProjectionExpectation,
    apply: (permit: CurrentReviewInboxProjectionPermit) => Promise<T>,
  ): Promise<ReviewResponseTargetAuthorityResult<T>>
}>
