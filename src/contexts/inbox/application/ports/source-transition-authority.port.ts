/**
 * Inbox-owned boundary for Review's current source-content transition.
 *
 * The durable event is only a wake-up hint. Review must hold its stable-source
 * fence while `apply` commits the Inbox-owned scrub, optional close, and
 * receipt. This prevents a delayed transition from closing an Inbox item
 * after the same stable Review has already been re-observed as active.
 */

export type SourceTransitionExpectation = Readonly<{
  organizationId: string
  propertyId: string
  reviewId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  change: 'source_expired' | 'provider_deleted'
  occurredAt: Date
}>

export type CurrentSourceTransitionPermit = SourceTransitionExpectation &
  Readonly<{
    authority: 'review.current-source-transition.v1'
  }>

export type SourceTransitionAuthorityResult<T> =
  Readonly<{ status: 'current'; value: T }> | Readonly<{ status: 'obsolete' }>

export type SourceTransitionAuthorityPort = Readonly<{
  withExactCurrent<T>(
    expectation: SourceTransitionExpectation,
    apply: (permit: CurrentSourceTransitionPermit) => Promise<T>,
  ): Promise<SourceTransitionAuthorityResult<T>>
}>
