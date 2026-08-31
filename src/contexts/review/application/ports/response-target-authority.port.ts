/**
 * Content-free Review authority for Inbox's Google Review Response Target.
 *
 * The provider snapshot records why a material revision was observed. The
 * authority keeps the current Review source fence while Inbox commits its own
 * cycle and immutable target snapshot; Review tables and provider content
 * never cross the context boundary.
 */

export type ReviewProviderObservationOrigin =
  'ongoing' | 'historical_onboarding' | 'legacy_unknown'

export type ReviewResponseTargetEligibility =
  'measured' | 'historical_onboarding' | 'legacy_unknown'

export type ReviewResponseTargetExpectation = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
}>

export type ReviewCurrentResponseTargetPermit = Readonly<{
  authority: 'review.current-response-target.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  materialReviewRevision: number
  eligibility: ReviewResponseTargetEligibility
  /** Google's publication/revision instant; null for deliberately excluded facts. */
  responseTargetStartAt: Date | null
}>

export type ReviewInboxProjectionEventKind = 'created' | 'updated'

export type ReviewInboxProjectionExpectation = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  eventSourceRevision: number
  eventKind: ReviewInboxProjectionEventKind
}>

/**
 * Immutable, content-free provenance for one Material Review Revision.
 *
 * Unlike `ReviewCurrentResponseTargetPermit`, this permit may describe a
 * historical revision. It is issued only inside `withInboxProjection` while
 * Review holds the current source fence, and Inbox accepts it only for its
 * source-event projection path.
 */
export type ReviewInboxProjectionRevisionPermit = Readonly<{
  authority: 'review.inbox-projection-revision.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  materialReviewRevision: number
  eligibility: ReviewResponseTargetEligibility
  responseTargetStartAt: Date | null
  /** Review's durable observation time for this material revision. */
  observedAt: Date
}>

/** Exact current Review source snapshot used to converge Inbox projections. */
export type ReviewCurrentInboxProjectionPermit = Readonly<{
  authority: 'review.current-inbox-projection.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  platform: 'google'
  /** Stable Inbox ordering date; never contains reviewer text or identity. */
  sourceDate: Date
  sourceContentState: 'active' | 'source_expired' | 'provider_deleted'
  sourceContentErasedAt: Date | null
  currentMaterialReviewRevision: number
  revisions: readonly [
    ReviewInboxProjectionRevisionPermit,
    ...ReviewInboxProjectionRevisionPermit[],
  ]
}>

export type ReviewResponseTargetAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type ReviewResponseTargetAuthority = Readonly<{
  withExactCurrent<T>(
    expectation: ReviewResponseTargetExpectation,
    apply: (permit: ReviewCurrentResponseTargetPermit) => Promise<T>,
  ): Promise<ReviewResponseTargetAuthorityResult<T>>
  withExactCurrentBatch<T>(
    expectations: readonly ReviewResponseTargetExpectation[],
    apply: (permits: readonly ReviewCurrentResponseTargetPermit[]) => Promise<T>,
  ): Promise<ReviewResponseTargetAuthorityResult<T>>
  /**
   * Hold Review's current source fence while Inbox atomically materializes or
   * catches up its stable item and complete material-revision history.
   */
  withInboxProjection<T>(
    expectation: ReviewInboxProjectionExpectation,
    apply: (permit: ReviewCurrentInboxProjectionPermit) => Promise<T>,
  ): Promise<ReviewResponseTargetAuthorityResult<T>>
}>
