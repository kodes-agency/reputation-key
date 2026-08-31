/**
 * Content-free exact-current authority for a Review source transition.
 *
 * The implementation keeps the stable Review row locked until `apply`
 * resolves. A foreign context can therefore commit its own projection update
 * without a re-observation making the identifier-only transition stale between
 * validation and commit.
 */

export type ReviewSourceTransitionChange = 'source_expired' | 'provider_deleted'

export type ReviewSourceTransitionExpectation = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  change: ReviewSourceTransitionChange
  occurredAt: Date
}>

export type ReviewCurrentSourceTransitionPermit = Readonly<{
  authority: 'review.current-source-transition.v1'
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  change: ReviewSourceTransitionChange
  occurredAt: Date
}>

export type ReviewSourceTransitionAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type ReviewSourceTransitionAuthority = Readonly<{
  withExactCurrent<T>(
    expectation: ReviewSourceTransitionExpectation,
    apply: (permit: ReviewCurrentSourceTransitionPermit) => Promise<T>,
  ): Promise<ReviewSourceTransitionAuthorityResult<T>>
}>
