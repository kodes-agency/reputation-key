import type { OrganizationId, PropertyId, ReplyId, ReviewId } from '#/shared/domain/ids'

export type GoogleReplyObservationSource = 'provider_snapshot' | 'targeted_reconciliation'

export type GoogleReplyPublicationTarget = Readonly<{
  replyId: ReplyId
  publicationCycle: number
  attemptNumber: number
}>

type GoogleReplyObservationBase = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  materialReviewRevision: number
  /** Monotonic token allocated after the provider response is acquired. */
  readGeneration: number
  observationKey: string
  source: GoogleReplyObservationSource
  observedText: string | null
  providerUpdatedAt: Date | null
  observedAt: Date
  contentExpiresAt: Date
}>

export type RecordGoogleReplyObservation = GoogleReplyObservationBase &
  (
    | Readonly<{
        source: 'provider_snapshot'
        publicationTarget?: never
      }>
    | Readonly<{
        source: 'targeted_reconciliation'
        publicationTarget: GoogleReplyPublicationTarget
      }>
  )

export type GoogleReplyObservationResult = Readonly<{
  observationRevision: number
  change: 'added' | 'edited' | 'deleted' | 'unchanged'
  resolution:
    'confirmed_on_google' | 'external_current_live' | 'diverged' | 'absent' | 'unchanged'
  matchedReplyId: ReplyId | null
  matchedPublicationCycle: number | null
  duplicate: boolean
}>

export type GoogleReplyObservationHeadFence = Readonly<{
  observationRevision: number
  sourceEpoch: number
  materialReviewRevision: number
}>

/**
 * Current provider-reply content before the serving eligibility rule is
 * applied. The observation store owns the head join; `eligible-reads.ts` owns
 * whether its provider-controlled text may leave Review.
 */
export type CurrentGoogleReplyObservation = Readonly<{
  id: string
  organizationId: OrganizationId
  reviewId: ReviewId
  observationRevision: number
  state: 'live' | 'absent'
  provenance: 'repkey_confirmed' | 'external_or_unknown' | 'none'
  normalizedText: string | null
  matchedReplyId: ReplyId | null
  providerUpdatedAt: Date | null
  observedAt: Date
  contentExpiresAt: Date
  contentState: 'active' | 'source_expired' | 'provider_deleted'
}>

/** Read side exposed only to Review's governed serving service. */
export type GoogleReplyObservationLookup = Readonly<{
  findCurrentByReviewId(
    reviewId: ReviewId,
    organizationId: OrganizationId,
  ): Promise<CurrentGoogleReplyObservation | null>
}>

/** Atomic observation history/head writer and the sole authority allowed to
 * confirm a local Reply as published. */
export type GoogleReplyObservationStore = Readonly<{
  /** Allocate immediately after provider response acquisition so response
   * order, not request-start order, fences the head. Unused generations are
   * expected when later validation or persistence fails. */
  allocateReadGeneration(): Promise<number>
  findCurrentHead(input: {
    organizationId: OrganizationId
    propertyId: PropertyId
    reviewId: ReviewId
  }): Promise<GoogleReplyObservationHeadFence | null>
  record(input: RecordGoogleReplyObservation): Promise<GoogleReplyObservationResult>
}>
